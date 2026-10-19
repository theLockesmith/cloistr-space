/**
 * The real nostr-tools Relay, driven over a fake socket that speaks NIP-42 the
 * way relay.cloistr.xyz does. threadPublish.test.ts covers the publish logic
 * with a fake connection; this covers the adapter between it and nostr-tools,
 * where the order of the relay's messages matters.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { generateSecretKey, finalizeEvent, verifyEvent, type Event } from 'nostr-tools';
import { openRelay, publishWrap } from './wrapRelay';

type Mode = { earlyChallenge: boolean; neverOpen: boolean };

class FakeRelaySocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static mode: Mode = { earlyChallenge: false, neverOpen: false };
  static sockets: FakeRelaySocket[] = [];

  readyState = FakeRelaySocket.CONNECTING;
  onopen?: () => void;
  onmessage?: (ev: { data: string }) => void;
  onclose?: (ev: { code: number; reason: string }) => void;
  onerror?: () => void;
  closed = false;
  stored: Event[] = [];
  authedAs: string | null = null;
  readonly challenge: string;

  constructor(public url: string) {
    FakeRelaySocket.sockets.push(this);
    this.challenge = 'challenge-' + FakeRelaySocket.sockets.length;
    if (FakeRelaySocket.mode.neverOpen) return;
    setTimeout(() => {
      this.readyState = FakeRelaySocket.OPEN;
      this.onopen?.();
      // Some relays send the challenge the moment the socket opens.
      if (FakeRelaySocket.mode.earlyChallenge) this.emit(['AUTH', this.challenge]);
    }, 0);
  }

  emit(msg: unknown[]) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  send(raw: string) {
    const [type, ev] = JSON.parse(raw) as [string, Event];
    if (type === 'EVENT') {
      if (this.authedAs === null) {
        this.emit(['OK', ev.id, false, 'auth-required: authentication required to publish events']);
        // relay.cloistr.xyz sends the challenge only after refusing the first EVENT.
        if (!FakeRelaySocket.mode.earlyChallenge) this.emit(['AUTH', this.challenge]);
        return;
      }
      if (this.authedAs !== ev.pubkey) {
        this.emit(['OK', ev.id, false, 'restricted: you can only publish events as your authenticated identity']);
        return;
      }
      this.stored.push(ev);
      this.emit(['OK', ev.id, true, '']);
    } else if (type === 'AUTH') {
      const ok = verifyEvent(ev) && ev.kind === 22242 && ev.tags.some((t) => t[0] === 'challenge' && t[1] === this.challenge);
      if (ok) this.authedAs = ev.pubkey;
      this.emit(['OK', ev.id, ok, ok ? '' : 'auth-required: bad auth event']);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = FakeRelaySocket.CLOSED;
    this.onclose?.({ code: 1000, reason: '' });
  }
}

const URL = 'wss://fake.relay';
const ws = FakeRelaySocket as unknown as typeof WebSocket;

function makeWrap() {
  const sk = generateSecretKey();
  const event = finalizeEvent({ kind: 1059, content: 'sealed', tags: [['t', 'ab']], created_at: 1_790_000_000 }, sk);
  return { event, sk };
}

beforeEach(() => {
  FakeRelaySocket.sockets = [];
  FakeRelaySocket.mode = { earlyChallenge: false, neverOpen: false };
});

describe('openRelay with the real nostr-tools Relay', () => {
  const open = (opts: { connectTimeoutMs?: number } = {}) => (url: string, sign: Parameters<typeof openRelay>[1]) =>
    openRelay(url, sign, { websocketImplementation: ws, ...opts });

  it('challenge AFTER the first EVENT (relay.cloistr.xyz): refused, signs in, resent, stored', async () => {
    const { event, sk } = makeWrap();
    await publishWrap(event, sk, { relayUrls: [URL], open: open(), challengeWaitMs: 500 });

    const [s] = FakeRelaySocket.sockets;
    expect(s.stored.map((e) => e.id)).toEqual([event.id]);
    expect(s.authedAs).toBe(event.pubkey);
    expect(s.closed).toBe(true);
  });

  it('challenge sent the moment the socket opens: still signs in as the wrap’s key and is stored', async () => {
    FakeRelaySocket.mode.earlyChallenge = true;
    const { event, sk } = makeWrap();
    await publishWrap(event, sk, { relayUrls: [URL], open: open(), challengeWaitMs: 500 });

    const [s] = FakeRelaySocket.sockets;
    expect(s.stored.map((e) => e.id)).toEqual([event.id]);
    expect(s.authedAs).toBe(event.pubkey);
    expect(s.closed).toBe(true);
  });

  it('a connection that never opens fails within the connect timeout, and its socket is closed', async () => {
    FakeRelaySocket.mode.neverOpen = true;
    const { event, sk } = makeWrap();
    const started = Date.now();

    await expect(
      publishWrap(event, sk, { relayUrls: [URL], open: open({ connectTimeoutMs: 50 }) }),
    ).rejects.toThrow(/connect/i);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(FakeRelaySocket.sockets[0].closed).toBe(true);
  });
});
