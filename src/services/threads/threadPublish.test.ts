/**
 * A gift wrap is signed by a one-time key, and the live relay accepts an event
 * only from the identity its connection signed in as (NIP-42). Space used to
 * send wraps over the user's own signed-in connection, so the relay refused
 * every one: "restricted: you can only publish events as your authenticated
 * identity" (found by the live !237 proof, 2026-10-19). Had it accepted them,
 * it would have learned which user sent each "anonymous" wrap.
 *
 * The fake relay below behaves as the live one does: the first EVENT is refused
 * with auth-required and a challenge follows; only a sign-in by the event's own
 * key lets it through.
 */
import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent, type Event, type EventTemplate, type VerifiedEvent } from 'nostr-tools';
import { GIFT_WRAP_KIND } from './giftWrap';
import type { WrapConnection } from './wrapRelay';

interface FakeRelay {
  url: string;
  connections: number;
  closed: number;
  stored: Event[];
  auths: VerifiedEvent[];
}

/** Behaves like relay.cloistr.xyz; `refuse` makes it refuse even after sign-in. */
function fakeRelays(urls: string[], opts: { refuse?: string; noChallenge?: boolean } = {}) {
  const relays = new Map<string, FakeRelay>(urls.map((url) => [url, { url, connections: 0, closed: 0, stored: [], auths: [] }]));
  const open = async (url: string, sign: (t: EventTemplate) => Promise<VerifiedEvent>): Promise<WrapConnection> => {
    const r = relays.get(url);
    if (!r) throw new Error(`connection refused: ${url}`);
    r.connections += 1;
    const challenge = 'challenge-' + r.connections;
    let authedAs: string | null = null;
    return {
      async publish(event: Event) {
        if (authedAs === null) throw new Error('auth-required: this relay requires authentication');
        if (authedAs !== event.pubkey) throw new Error('restricted: you can only publish events as your authenticated identity');
        if (opts.refuse) throw new Error(opts.refuse);
        r.stored.push(event);
        return '';
      },
      async signIn(waitMs: number) {
        if (opts.noChallenge) {
          await new Promise((res) => setTimeout(res, waitMs));
          throw new Error('The relay asked to sign in but sent no sign-in challenge.');
        }
        const evt = await sign({
          kind: 22242,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['relay', url], ['challenge', challenge]],
          content: '',
        });
        r.auths.push(evt);
        if (!verifyEvent(evt)) throw new Error('auth event invalid');
        authedAs = evt.pubkey;
      },
      close() {
        r.closed += 1;
      },
    };
  };
  return { relays, open };
}

const URL_A = 'wss://relay.example';
const threadSecret = 'cc'.repeat(32);
const authorPk = 'dd'.repeat(32);

describe('publishMessage: a wrap goes out as its own one-time key', () => {
  it('signs in as the wrap’s key on a connection of its own, and the relay stores it', async () => {
    const { publishMessage } = await import('./threadPublish');
    const { relays, open } = fakeRelays([URL_A]);

    await publishMessage('hello world', authorPk, threadSecret, { relayUrls: [URL_A], open });

    const r = relays.get(URL_A)!;
    expect(r.stored).toHaveLength(1);
    const wrap = r.stored[0];
    expect(wrap.kind).toBe(GIFT_WRAP_KIND);
    expect(wrap.pubkey).not.toBe(authorPk);
    // The sign-in names the wrap's key and answers this connection's challenge.
    expect(r.auths).toHaveLength(1);
    expect(r.auths[0].pubkey).toBe(wrap.pubkey);
    expect(r.auths[0].tags).toContainEqual(['challenge', 'challenge-1']);
    expect(r.closed).toBe(1);
  });

  it('uses a fresh connection, and a fresh key, for every wrap', async () => {
    const { publishMessage } = await import('./threadPublish');
    const { relays, open } = fakeRelays([URL_A]);

    await publishMessage('one', authorPk, threadSecret, { relayUrls: [URL_A], open });
    await publishMessage('two', authorPk, threadSecret, { relayUrls: [URL_A], open });

    const r = relays.get(URL_A)!;
    expect(r.connections).toBe(2);
    expect(new Set(r.auths.map((a) => a.pubkey)).size).toBe(2);
  });

  it('throws the relay’s own reason when it refuses, and still closes the connection', async () => {
    const { publishMessage } = await import('./threadPublish');
    const { relays, open } = fakeRelays([URL_A], { refuse: 'blocked: rate limited' });

    await expect(publishMessage('hi', authorPk, threadSecret, { relayUrls: [URL_A], open })).rejects.toThrow(
      /blocked: rate limited/,
    );
    expect(relays.get(URL_A)!.closed).toBe(1);
  });

  it('throws when the relay asks for sign-in but never sends a challenge', async () => {
    const { publishMessage } = await import('./threadPublish');
    const { open } = fakeRelays([URL_A], { noChallenge: true });

    await expect(
      publishMessage('hi', authorPk, threadSecret, { relayUrls: [URL_A], open, challengeWaitMs: 50 }),
    ).rejects.toThrow(/no sign-in challenge/);
  });

  it('succeeds when one relay of two takes it', async () => {
    const { publishMessage } = await import('./threadPublish');
    const { relays, open } = fakeRelays([URL_A]);

    await publishMessage('hi', authorPk, threadSecret, { relayUrls: ['wss://down.example', URL_A], open });
    expect(relays.get(URL_A)!.stored).toHaveLength(1);
  });

  it('throws when no relay takes it, rather than reporting a send', async () => {
    const { publishMessage } = await import('./threadPublish');
    const { open } = fakeRelays([]);

    await expect(publishMessage('hi', authorPk, threadSecret, { relayUrls: [URL_A], open })).rejects.toThrow(
      /connection refused/,
    );
  });
});

describe('publishKeyHandoff: a hand-off goes out as its own one-time key', () => {
  it('signs in as the hand-off’s key, never the granter’s', async () => {
    const { publishKeyHandoff } = await import('./threadPublish');
    const { relays, open } = fakeRelays([URL_A]);
    const granterSk = generateSecretKey();

    await publishKeyHandoff('thread-1', threadSecret, granterSk, getPublicKey(generateSecretKey()), {
      relayUrls: [URL_A],
      open,
    });

    const r = relays.get(URL_A)!;
    expect(r.stored).toHaveLength(1);
    expect(r.stored[0].kind).toBe(GIFT_WRAP_KIND);
    expect(r.auths[0].pubkey).toBe(r.stored[0].pubkey);
    expect(r.auths[0].pubkey).not.toBe(getPublicKey(granterSk));
  });
});
