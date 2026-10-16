/**
 * Security (2026-10-14): a gift-wrapped hand-off does not authenticate its
 * granter. The wrap is signed by a throwaway key and `g` is only a claim in
 * the encrypted payload, so anyone who knows a member's pubkey and a trusted
 * granter's pubkey can send the member a key that claims to come from the
 * granter. Before this fix the reader stored such a key at once and showed
 * the attacker's messages as if the granter's thread had sent them.
 *
 * Now every hand-off for a key the user does not already hold waits until the
 * user accepts it. Covers both the raw-key path and the signer path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { generateSecretKey, getPublicKey, nip44, finalizeEvent } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';
import { ThreadKeyStore } from './threadKeyStore';
import { computeHandoffBucket, ecdhHex, getWindowId, expiryTimestamp } from './bucketCrypto';
import { GIFT_WRAP_KIND, wrapThreadMessage } from './giftWrap';

type Wrap = { id: string; pubkey: string; content: string; tags: string[][] };
const relay: { events: Wrap[] } = { events: [] };
const store = { current: new ThreadKeyStore() };
const auth: { signer: unknown } = { signer: null };

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({ subscribe: () => ({}), isConnected: true }),
  subscribeStream: (_s: unknown, filters: Array<Record<string, string[]>>, handlers: { onEvent: (e: Wrap) => void; onEose?: () => void }) => {
    const wanted = new Set(filters[0]['#t']);
    let stopped = false;
    queueMicrotask(() => {
      for (const e of relay.events) {
        if (stopped) return;
        const b = e.tags.find((t) => t[0] === 't')?.[1];
        if (b && wanted.has(b)) handlers.onEvent(e);
      }
      handlers.onEose?.();
    });
    return { stop: () => { stopped = true; } };
  },
}));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => ({ signer: auth.signer }) }));
vi.mock('./useThreadKeyStore', () => ({ useThreadKeyStore: () => store.current }));

import { useBucketReader } from './useBucketReader';

const memberSk = generateSecretKey();
const memberPk = getPublicKey(memberSk);
const trustedGranterPk = getPublicKey(generateSecretKey());
const attackerThreadSk = generateSecretKey();
const attackerThreadPk = getPublicKey(attackerThreadSk);

/**
 * What an attacker can build with public information only: the member's
 * pubkey, the trusted granter's pubkey, and a bucket value. The bucket is
 * copied off any genuine hand-off for this pair (it is in the clear on the
 * relay for the whole window); here it is computed directly for brevity.
 */
function forgedHandoff(now: number): Wrap {
  const wid = getWindowId(now);
  const throwaway = generateSecretKey();
  const payload = JSON.stringify({ tid: 'looks-official', sec: bytesToHex(attackerThreadSk), g: trustedGranterPk });
  return finalizeEvent(
    {
      kind: GIFT_WRAP_KIND,
      content: nip44.v2.encrypt(payload, nip44.v2.utils.getConversationKey(throwaway, memberPk)),
      tags: [['t', computeHandoffBucket(ecdhHex(memberSk, trustedGranterPk), wid)], ['expiration', String(expiryTimestamp(wid))]],
      created_at: now,
    },
    throwaway,
  ) as unknown as Wrap;
}

function remoteSigner(userSk: Uint8Array) {
  const ck = (pk: string) => nip44.v2.utils.getConversationKey(userSk, pk);
  return {
    getPublicKey: async () => getPublicKey(userSk),
    nip44Decrypt: async (pk: string, ct: string) => nip44.v2.decrypt(ct, ck(pk)),
    nip44Encrypt: async (pk: string, pt: string) => nip44.v2.encrypt(pt, ck(pk)),
    sendRequest: async (_method: string, params: string[]) =>
      computeHandoffBucket(ecdhHex(userSk, params[0]), Number(params[1])),
  };
}

beforeEach(() => {
  store.current = new ThreadKeyStore();
  try { localStorage.clear(); } catch { /* none */ }
  const now = Math.floor(Date.now() / 1000);
  relay.events = [
    forgedHandoff(now),
    wrapThreadMessage('please send your seed phrase', trustedGranterPk, bytesToHex(attackerThreadSk), now) as unknown as Wrap,
  ];
});

describe.each([
  ['raw-key user', () => { auth.signer = null; return memberSk; }],
  ['signer (NIP-46) user', () => { auth.signer = remoteSigner(memberSk); return null; }],
])('a forged hand-off, %s', (_label, setup) => {
  it('is held for the user instead of entering the key store', async () => {
    const secret = setup();
    const { result } = renderHook(() => useBucketReader(secret, [trustedGranterPk]));

    await waitFor(() => expect(result.current.pendingHandoffs).toHaveLength(1), { timeout: 3000 });
    expect(result.current.pendingHandoffs[0].granterPubkey).toBe(trustedGranterPk);
    expect(store.current.get(attackerThreadPk)).toBeFalsy();
    expect(result.current.handoffs).toHaveLength(0);
    expect(result.current.messages).toHaveLength(0);
  });

  it('only enters the key store when the user accepts it', async () => {
    const secret = setup();
    const { result } = renderHook(() => useBucketReader(secret, [trustedGranterPk]));
    await waitFor(() => expect(result.current.pendingHandoffs).toHaveLength(1), { timeout: 3000 });

    act(() => result.current.acceptHandoff(result.current.pendingHandoffs[0].wrapId));

    expect(store.current.get(attackerThreadPk)).toBeTruthy();
    await waitFor(() => expect(result.current.messages).toHaveLength(1), { timeout: 3000 });
    expect(result.current.pendingHandoffs).toHaveLength(0);
  });

  it('stays on screen when the reader refreshes', async () => {
    const secret = setup();
    const { result } = renderHook(() => useBucketReader(secret, [trustedGranterPk]));
    await waitFor(() => expect(result.current.pendingHandoffs).toHaveLength(1), { timeout: 3000 });

    // The relay does not send it again, as when the offer has scrolled out of
    // the window the restarted subscription asks for.
    relay.events = [];
    act(() => result.current.refresh());
    await new Promise((r) => setTimeout(r, 50));

    expect(result.current.pendingHandoffs).toHaveLength(1);
  });

  it('once dismissed, is not offered again', async () => {
    const secret = setup();
    const first = renderHook(() => useBucketReader(secret, [trustedGranterPk]));
    await waitFor(() => expect(first.result.current.pendingHandoffs).toHaveLength(1), { timeout: 3000 });
    act(() => first.result.current.dismissHandoff(first.result.current.pendingHandoffs[0].wrapId));
    first.unmount();

    const second = renderHook(() => useBucketReader(secret, [trustedGranterPk]));
    await new Promise((r) => setTimeout(r, 300));
    expect(second.result.current.pendingHandoffs).toHaveLength(0);
    expect(store.current.get(attackerThreadPk)).toBeFalsy();
  });
});
