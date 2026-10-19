/**
 * Publish a gift wrap as its own one-time key.
 *
 * The relay accepts an event only from the identity its connection signed in
 * as (NIP-42), and a wrap is signed by a one-time key. Space used to send wraps
 * over the user's own connection, signed in as the user, so the relay refused
 * every one ("restricted: you can only publish events as your authenticated
 * identity"). Had it accepted them, it would have learned which user sent each
 * wrap, which is what the one-time key exists to hide.
 *
 * So each wrap gets a connection of its own that signs in as the wrap's key and
 * is closed afterwards. The relay sends its challenge only after refusing the
 * first EVENT with auth-required (threads wire format), so: send, sign in, send
 * again.
 */
import { Relay, finalizeEvent, type Event, type EventTemplate, type VerifiedEvent } from 'nostr-tools';
import { withPublishTimeout } from '../headless';
import { defaultRelays } from '@/config/environment';

type Sign = (template: EventTemplate) => Promise<VerifiedEvent>;

/** Under PUBLISH_TIMEOUT_MS, so a dead relay fails on its own reason, not the overall timeout. */
const CONNECT_TIMEOUT_MS = 8_000;

/** A relay connection that can sign in as one key; tests supply a fake. */
export interface WrapConnection {
  /** Resolves when the relay stored the event; rejects with its reason. */
  publish(event: Event): Promise<string>;
  /** Answer the relay's sign-in challenge; rejects if none arrives within waitMs. */
  signIn(waitMs: number): Promise<void>;
  close(): void;
}

export interface WrapPublishOptions {
  /** Defaults to the app's relays. */
  relayUrls?: readonly string[];
  /** Defaults to a real WebSocket connection. */
  open?: (url: string, sign: Sign) => Promise<WrapConnection>;
  /** How long to wait for the challenge after auth-required. */
  challengeWaitMs?: number;
}

export async function openRelay(
  url: string,
  sign: Sign,
  opts: { connectTimeoutMs?: number; websocketImplementation?: typeof WebSocket } = {},
): Promise<WrapConnection> {
  // Relay's declared options omit websocketImplementation, but its constructor
  // spreads them into AbstractRelay's, which takes it (nostr-tools relay.js).
  // Passed only for tests; omitted, nostr-tools keeps its own default socket.
  const relayOpts = opts.websocketImplementation ? { websocketImplementation: opts.websocketImplementation } : {};
  const relay = new Relay(url, relayOpts as ConstructorParameters<typeof Relay>[1]);
  let challenged = () => {};
  const challenge = new Promise<void>((resolve) => {
    challenged = resolve;
  });
  // Set before connecting: a relay may send its challenge the moment the socket
  // opens, and nostr-tools signs in only if onauth is already there to call.
  relay.onauth = (template) => {
    challenged();
    return sign(template);
  };
  try {
    // On timeout nostr-tools closes the socket itself, so a hung connect leaves nothing open.
    await relay.connect({ timeout: opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS });
  } catch (e) {
    relay.close();
    // nostr-tools rejects with a bare string ("connection timed out").
    throw e instanceof Error ? e : new Error(`Could not connect to ${url}: ${String(e)}`);
  }
  return {
    publish: (event) => relay.publish(event),
    async signIn(waitMs) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const none = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The relay asked to sign in but sent no sign-in challenge.')), waitMs);
      });
      await Promise.race([challenge, none]).finally(() => clearTimeout(timer));
      // Joins the sign-in onauth started, and resolves when the relay accepts it.
      await relay.auth(sign);
    },
    close: () => relay.close(),
  };
}

async function publishOne(url: string, event: Event, oneTimeSk: Uint8Array, opts: WrapPublishOptions): Promise<void> {
  const sign: Sign = async (template) => finalizeEvent(template, oneTimeSk);
  const conn = await (opts.open ?? openRelay)(url, sign);
  try {
    try {
      await conn.publish(event);
      return;
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith('auth-required')) throw e;
    }
    await conn.signIn(opts.challengeWaitMs ?? 5000);
    await conn.publish(event);
  } finally {
    conn.close();
  }
}

/**
 * Resolves with how many relays stored the wrap; throws, with the first
 * relay's own reason, when none did or none answered in time.
 */
export async function publishWrap(event: Event, oneTimeSk: Uint8Array, opts: WrapPublishOptions = {}): Promise<number> {
  const urls = opts.relayUrls ?? defaultRelays;
  if (urls.length === 0) throw new Error('No relays configured.');
  const results = await withPublishTimeout(
    Promise.allSettled(urls.map((url) => publishOne(url, event, oneTimeSk, opts))),
  );
  const accepted = results.filter((r) => r.status === 'fulfilled').length;
  if (accepted === 0) {
    const reason = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason;
    throw reason instanceof Error ? reason : new Error(String(reason));
  }
  return accepted;
}
