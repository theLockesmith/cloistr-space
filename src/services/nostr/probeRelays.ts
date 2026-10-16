/**
 * @fileoverview Ask one relay a question and know whether THAT relay answered.
 *
 * fetchEvents merges relays and resolves the same way whether a relay said
 * "nothing" or never said anything. NDK's 'eose' is per subscription, not per
 * relay, and can fire with relays still silent (its own timers, or a cache).
 * So each relay gets its own subscription, and it counts as answered only when
 * eose fires with that relay in eosesSeen. Everything else is a failure.
 *
 * Used where publishing is only safe if every one of the user's relays
 * confirmed the absence of something (see groups/projectSetup.ts).
 */

import type { Event } from 'nostr-tools';
import type { RelayAnswer } from '../headless';

/** Long enough for a relay that wants NIP-42 auth first; short enough to give up. */
export const PROBE_TIMEOUT_MS = 8_000;

interface ProbeSubscription {
  eosesSeen: Set<{ url: string }>;
  on(event: 'closed', cb: (relay: { url: string }, reason: string) => void): void;
  stop(): void;
}

/** The slice of NDK.subscribe this needs. */
export type ProbeSubscribe = (
  filters: Record<string, unknown>[],
  opts: Record<string, unknown>,
  handlers: { onEvent: (e: { rawEvent: () => unknown }) => void; onEose: () => void },
) => ProbeSubscription;

const sameRelay = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

export function probeRelay(
  subscribe: ProbeSubscribe,
  url: string,
  filter: Record<string, unknown>,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<RelayAnswer> {
  return new Promise((resolve) => {
    const events: Event[] = [];
    let settled = false;
    let sub: ProbeSubscription | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (answer: RelayAnswer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub?.stop();
      resolve(answer);
    };

    sub = subscribe(
      [filter],
      { closeOnEose: true, groupable: false, relayUrls: [url], cacheUsage: 'ONLY_RELAY' },
      {
        onEvent: (e) => events.push(e.rawEvent() as Event),
        onEose: () => {
          const fromThisRelay = [...(sub?.eosesSeen ?? [])].some((r) => sameRelay(r.url, url));
          settle(
            fromThisRelay
              ? { url, status: 'answered', events }
              : { url, status: 'failed', reason: 'The relay did not confirm it had sent everything' },
          );
        },
      },
    );
    // A relay's CLOSED arrives over the socket, so it cannot precede this line.
    sub.on('closed', (_relay, reason) => settle({ url, status: 'failed', reason: reason || 'Closed by the relay' }));
    timer = setTimeout(
      () => settle({ url, status: 'failed', reason: `No answer within ${timeoutMs / 1000}s` }),
      timeoutMs,
    );
  });
}
