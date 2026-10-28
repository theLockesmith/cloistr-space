import { describe, it, expect, vi } from 'vitest';
import type { Event, UnsignedEvent } from 'nostr-tools';
import type { SignerInterface } from '../headless';
import { ZAP_REQUEST_KIND } from '@/types/social';
import {
  bech32Encode,
  bech32Decode,
  lnurlPayUrlFromLud16,
  lnurlPayUrlFromLud06,
  resolveLnurlPayUrl,
  hasLightningAddress,
  fetchLnurlPayInfo,
  assertSupportsNostrZap,
  buildZapRequest,
  decodeBolt11AmountMsats,
  requestZapInvoice,
} from './zapService';

const ME = 'aa'.repeat(32);
const THEM = 'dd'.repeat(32);
const NOTE = 'ee'.repeat(32);

function mockSigner(): SignerInterface {
  return {
    getPublicKey: async () => ME,
    signEvent: async (unsigned: UnsignedEvent): Promise<Event> => ({
      ...unsigned,
      id: 'bb'.repeat(32),
      sig: 'cc'.repeat(64),
    }),
    encrypt: async () => '',
    decrypt: async () => '',
  };
}

/** A minimal fetch mock: maps exact URL prefixes to canned JSON responses, in order. */
function mockFetch(responses: { match: (url: string) => boolean; json?: unknown; ok?: boolean; status?: number; error?: Error }[]) {
  return vi.fn(async (url: string) => {
    const hit = responses.find((r) => r.match(url));
    if (!hit) throw new Error(`mockFetch: no handler for ${url}`);
    if (hit.error) throw hit.error;
    return {
      ok: hit.ok ?? true,
      status: hit.status ?? 200,
      json: async () => hit.json,
    } as unknown as Response;
  });
}

describe('bech32', () => {
  it('round-trips arbitrary bytes through encode/decode', () => {
    const bytes = new TextEncoder().encode('https://cloistr.xyz/.well-known/lnurlp/alice');
    const encoded = bech32Encode('lnurl', bytes);
    const decoded = bech32Decode(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.hrp).toBe('lnurl');
    expect(new TextDecoder().decode(decoded!.bytes)).toBe(
      'https://cloistr.xyz/.well-known/lnurlp/alice'
    );
  });

  it('decodes the BIP-173 empty-data test vector', () => {
    const decoded = bech32Decode('A12UEL5L');
    expect(decoded).toEqual({ hrp: 'a', bytes: new Uint8Array() });
  });

  it('rejects mixed-case input', () => {
    expect(bech32Decode('A12uel5l')).toBeNull();
  });

  it('rejects a corrupted checksum', () => {
    expect(bech32Decode('a12uel5x')).toBeNull();
  });
});

describe('lnurlPayUrlFromLud16', () => {
  it('builds the well-known LNURL-pay URL', () => {
    expect(lnurlPayUrlFromLud16('alice@cloistr.xyz')).toBe(
      'https://cloistr.xyz/.well-known/lnurlp/alice'
    );
  });

  it('rejects a malformed address', () => {
    expect(lnurlPayUrlFromLud16('not-an-address')).toBeNull();
    expect(lnurlPayUrlFromLud16('alice@')).toBeNull();
    expect(lnurlPayUrlFromLud16('@domain.com')).toBeNull();
  });
});

describe('lnurlPayUrlFromLud06', () => {
  it('decodes a bech32 lnurl into its URL', () => {
    const url = 'https://cloistr.xyz/.well-known/lnurlp/alice';
    const encoded = bech32Encode('lnurl', new TextEncoder().encode(url));
    expect(lnurlPayUrlFromLud06(encoded)).toBe(url);
  });

  it('rejects a non-lnurl bech32 string', () => {
    const encoded = bech32Encode('other', new TextEncoder().encode('https://x.com'));
    expect(lnurlPayUrlFromLud06(encoded)).toBeNull();
  });

  it('rejects garbage input without throwing', () => {
    expect(lnurlPayUrlFromLud06('not bech32 at all')).toBeNull();
  });
});

describe('resolveLnurlPayUrl / hasLightningAddress', () => {
  it('returns null and false when neither lud16 nor lud06 is present', () => {
    expect(resolveLnurlPayUrl(undefined)).toBeNull();
    expect(resolveLnurlPayUrl({})).toBeNull();
    expect(hasLightningAddress(undefined)).toBe(false);
    expect(hasLightningAddress({})).toBe(false);
  });

  it('prefers lud16 over lud06 when both are present', () => {
    const lud06 = bech32Encode('lnurl', new TextEncoder().encode('https://legacy.example/lnurlp'));
    const resolved = resolveLnurlPayUrl({ lud16: 'bob@cloistr.xyz', lud06 });
    expect(resolved).toBe('https://cloistr.xyz/.well-known/lnurlp/bob');
  });

  it('falls back to lud06 when lud16 is absent', () => {
    const lud06 = bech32Encode('lnurl', new TextEncoder().encode('https://legacy.example/lnurlp'));
    expect(resolveLnurlPayUrl({ lud06 })).toBe('https://legacy.example/lnurlp');
    expect(hasLightningAddress({ lud06 })).toBe(true);
  });

  it('is false for a malformed lud16 with no lud06', () => {
    expect(hasLightningAddress({ lud16: 'garbage' })).toBe(false);
  });
});

describe('fetchLnurlPayInfo', () => {
  it('throws when the lightning address cannot be reached', async () => {
    const fetchFn = mockFetch([
      { match: () => true, error: new Error('network down') },
    ]) as unknown as typeof fetch;
    await expect(fetchLnurlPayInfo(fetchFn, 'https://x.com/lnurlp/bob')).rejects.toThrow(
      /Could not reach/
    );
  });

  it('throws on a LUD-03 error response', async () => {
    const fetchFn = mockFetch([
      { match: () => true, json: { status: 'ERROR', reason: 'no such user' } },
    ]) as unknown as typeof fetch;
    await expect(fetchLnurlPayInfo(fetchFn, 'https://x.com/lnurlp/bob')).rejects.toThrow(
      /no such user/
    );
  });

  it('reads allowsNostr: false through', async () => {
    const fetchFn = mockFetch([
      {
        match: () => true,
        json: {
          callback: 'https://x.com/callback',
          minSendable: 1000,
          maxSendable: 100000000,
          metadata: '[]',
          allowsNostr: false,
        },
      },
    ]) as unknown as typeof fetch;
    const info = await fetchLnurlPayInfo(fetchFn, 'https://x.com/lnurlp/bob');
    expect(info.allowsNostr).toBe(false);
    expect(() => assertSupportsNostrZap(info)).toThrow(/does not support zaps/);
  });
});

describe('buildZapRequest', () => {
  it('builds a kind:9734 with p, e, amount, relays and lnurl tags', () => {
    const template = buildZapRequest({
      eventId: NOTE,
      eventPubkey: THEM,
      amountMsats: 21000,
      relays: ['wss://relay.example'],
      lnurl: 'https://cloistr.xyz/.well-known/lnurlp/bob',
      comment: 'nice post',
    });

    expect(template.kind).toBe(ZAP_REQUEST_KIND);
    expect(template.content).toBe('nice post');
    expect(template.tags).toContainEqual(['p', THEM]);
    expect(template.tags).toContainEqual(['e', NOTE]);
    expect(template.tags).toContainEqual(['amount', '21000']);
    expect(template.tags).toContainEqual(['relays', 'wss://relay.example']);

    const lnurlTag = template.tags.find((t) => t[0] === 'lnurl');
    expect(lnurlTag).toBeDefined();
    const decoded = bech32Decode(lnurlTag![1]);
    expect(decoded?.hrp).toBe('lnurl');
    expect(new TextDecoder().decode(decoded!.bytes)).toBe(
      'https://cloistr.xyz/.well-known/lnurlp/bob'
    );
  });

  it('refuses a zero or negative amount', () => {
    expect(() =>
      buildZapRequest({
        eventId: NOTE,
        eventPubkey: THEM,
        amountMsats: 0,
        relays: ['wss://relay.example'],
        lnurl: 'https://x.com',
      })
    ).toThrow(/greater than zero/);
  });

  it('refuses to build with no relays', () => {
    expect(() =>
      buildZapRequest({
        eventId: NOTE,
        eventPubkey: THEM,
        amountMsats: 1000,
        relays: [],
        lnurl: 'https://x.com',
      })
    ).toThrow(/no relays/);
  });
});

describe('decodeBolt11AmountMsats', () => {
  it('parses a micro-bitcoin invoice', () => {
    // 2500u = 2500 * 1e-6 BTC = 250,000 sats = 250,000,000 msats
    expect(decodeBolt11AmountMsats('lnbc2500u1pjq8s3zpp5...')).toBe(250_000_000);
  });

  it('parses a milli-bitcoin invoice', () => {
    expect(decodeBolt11AmountMsats('lnbc1m1pjq8s3zpp5...')).toBe(100_000_000);
  });

  it('parses a nano-bitcoin invoice', () => {
    expect(decodeBolt11AmountMsats('lnbc100n1pjq8s3zpp5...')).toBe(10_000);
  });

  it('parses a testnet/regtest-style network prefix', () => {
    expect(decodeBolt11AmountMsats('lntb2500u1pjq8s3zpp5...')).toBe(250_000_000);
  });

  it('strips a lightning: URI prefix', () => {
    expect(decodeBolt11AmountMsats('lightning:LNBC2500U1PJQ8S3ZPP5...')).toBe(250_000_000);
  });

  it('returns null for a no-amount invoice', () => {
    expect(decodeBolt11AmountMsats('lnbc1pjq8s3zpp5...')).toBeNull();
  });

  it('returns null for garbage', () => {
    expect(decodeBolt11AmountMsats('not an invoice')).toBeNull();
  });
});

describe('requestZapInvoice', () => {
  const payUrl = 'https://cloistr.xyz/.well-known/lnurlp/bob';
  const payInfo = {
    callback: 'https://cloistr.xyz/lnurlp/callback',
    minSendable: 1000,
    maxSendable: 100_000_000_000,
    metadata: '[]',
    allowsNostr: true,
    nostrPubkey: 'ff'.repeat(32),
  };

  it('throws when the lightning address does not support Nostr zaps (allowsNostr: false)', async () => {
    const fetchFn = mockFetch([
      { match: (u) => u === payUrl, json: { ...payInfo, allowsNostr: false } },
    ]) as unknown as typeof fetch;

    await expect(
      requestZapInvoice(mockSigner(), fetchFn, {
        payUrl,
        eventId: NOTE,
        eventPubkey: THEM,
        amountMsats: 21000,
        relays: ['wss://relay.example'],
      })
    ).rejects.toThrow(/does not support zaps/);
  });

  it('throws and does not pay when the callback invoice amount does not match the request', async () => {
    const fetchFn = mockFetch([
      { match: (u) => u === payUrl, json: payInfo },
      // Requested 21000 msats but the callback returns an invoice for 5000 msats (5n).
      { match: (u) => u.startsWith(payInfo.callback), json: { pr: 'lnbc5n1pjq8s3zpp5...' } },
    ]) as unknown as typeof fetch;

    await expect(
      requestZapInvoice(mockSigner(), fetchFn, {
        payUrl,
        eventId: NOTE,
        eventPubkey: THEM,
        amountMsats: 21000,
        relays: ['wss://relay.example'],
      })
    ).rejects.toThrow(/does not match|Refusing to pay/);
  });

  it('throws on a callback error response, surfacing the reason', async () => {
    const fetchFn = mockFetch([
      { match: (u) => u === payUrl, json: payInfo },
      {
        match: (u) => u.startsWith(payInfo.callback),
        json: { status: 'ERROR', reason: 'amount too small' },
      },
    ]) as unknown as typeof fetch;

    await expect(
      requestZapInvoice(mockSigner(), fetchFn, {
        payUrl,
        eventId: NOTE,
        eventPubkey: THEM,
        amountMsats: 21000,
        relays: ['wss://relay.example'],
      })
    ).rejects.toThrow(/amount too small/);
  });

  it('throws when the callback cannot be reached, rather than swallowing the error', async () => {
    const fetchFn = mockFetch([
      { match: (u) => u === payUrl, json: payInfo },
      { match: (u) => u.startsWith(payInfo.callback), error: new Error('timed out') },
    ]) as unknown as typeof fetch;

    await expect(
      requestZapInvoice(mockSigner(), fetchFn, {
        payUrl,
        eventId: NOTE,
        eventPubkey: THEM,
        amountMsats: 21000,
        relays: ['wss://relay.example'],
      })
    ).rejects.toThrow(/Could not reach the zap callback/);
  });

  it('rejects an amount outside the LNURL service range before contacting the callback', async () => {
    const callback = vi.fn();
    const fetchFn = mockFetch([
      { match: (u) => u === payUrl, json: payInfo },
      { match: (u) => { callback(u); return u.startsWith(payInfo.callback); }, json: { pr: 'lnbc1pjq8s3zpp5...' } },
    ]) as unknown as typeof fetch;

    await expect(
      requestZapInvoice(mockSigner(), fetchFn, {
        payUrl,
        eventId: NOTE,
        eventPubkey: THEM,
        amountMsats: 1, // below minSendable of 1000
        relays: ['wss://relay.example'],
      })
    ).rejects.toThrow(/between/);
    expect(callback).not.toHaveBeenCalled();
  });

  it('returns the invoice when everything checks out, with a matching amount', async () => {
    const fetchFn = mockFetch([
      { match: (u) => u === payUrl, json: payInfo },
      // 21000 msats = 21n * 1000... use micro: 21000 msats -> not a round "u"/"n" unit necessarily.
      // 21000 msats = 21 * 1000 msats = 0.021 * 1e6 msats... simplest: express as 'n' (nano): amount*100 = 21000 -> amount=210n.
      { match: (u) => u.startsWith(payInfo.callback), json: { pr: 'lnbc210n1pjq8s3zpp5...', verify: 'https://cloistr.xyz/verify/abc' } },
    ]) as unknown as typeof fetch;

    const result = await requestZapInvoice(mockSigner(), fetchFn, {
      payUrl,
      eventId: NOTE,
      eventPubkey: THEM,
      amountMsats: 21000,
      relays: ['wss://relay.example'],
      comment: 'gm',
    });

    expect(result.pr).toBe('lnbc210n1pjq8s3zpp5...');
    expect(result.verify).toBe('https://cloistr.xyz/verify/abc');
  });

  it('signs the zap request as the caller and sends it in the nostr query param', async () => {
    let capturedUrl = '';
    const fetchFn = vi.fn(async (url: string) => {
      if (url === payUrl) {
        return { ok: true, status: 200, json: async () => payInfo } as unknown as Response;
      }
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ pr: 'lnbc1pjq8s3zpp5...' }) } as unknown as Response;
    }) as unknown as typeof fetch;

    await requestZapInvoice(mockSigner(), fetchFn, {
      payUrl,
      eventId: NOTE,
      eventPubkey: THEM,
      amountMsats: 21000,
      relays: ['wss://relay.example'],
    });

    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('amount')).toBe('21000');
    const nostrParam = parsed.searchParams.get('nostr');
    expect(nostrParam).toBeTruthy();
    const signedEvent = JSON.parse(nostrParam!);
    expect(signedEvent.kind).toBe(ZAP_REQUEST_KIND);
    expect(signedEvent.pubkey).toBe(ME);
    expect(signedEvent.sig).toBe('cc'.repeat(64));
  });
});
