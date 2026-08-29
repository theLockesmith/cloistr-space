/**
 * @fileoverview One-shot Nostr queries that cannot lose their result.
 *
 * NDK starts a subscription the moment you call subscribe() — index.d.ts:3373,
 * "Subscriptions automatically start unless autoStart is set to false". The
 * obvious-looking sequence
 *
 *   const sub = subscribe(filters, { closeOnEose: true });
 *   sub.on('event', ...);
 *   sub.on('eose', ...);
 *   sub.start();
 *
 * therefore has a window between subscribe() and the first .on() in which
 * delivery is simply dropped. Against a relay answering from storage, or an NDK
 * cache hit, that window is where the answer usually arrives.
 *
 * WHY THIS PATTERN LOOKS FINE AND MOSTLY IS: for a long-lived streaming
 * subscription (closeOnEose:false) missing the first tick costs nothing, more
 * events follow. useGroupChat and useGroups.startSubscription both attach after
 * start and are correct for exactly that reason. The pattern gets copied to a
 * one-shot query that resolves on eose, and there it is fatal — the query waits
 * out its timeout and reports "not found" for data that is sitting on the relay.
 *
 * That is what made groups vanish on reload (useGroups.fetchGroupMetadata) and
 * relay preferences resolve to the default (the relayPrefs pool adapter).
 *
 * NDK's own answer is to pass handlers as the third argument to subscribe, so
 * they are registered before anything can be delivered. Route one-shot queries
 * through here rather than reconstructing the sequence by hand.
 */

import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';

export interface OnceHandlers {
  onEvent?: (event: NDKEvent) => void;
  onEose?: () => void;
}

/**
 * The subset of NdkService.subscribe this needs, so callers can pass either the
 * service method or a test double without dragging NDK's full type in.
 */
export type SubscribeFn = (
  filters: NDKFilter[],
  opts?: { closeOnEose?: boolean; groupable?: boolean },
  handlers?: OnceHandlers
) => NDKSubscription;

/**
 * Run a single query and hand results to `handlers`.
 *
 * closeOnEose is set here rather than left to the caller: a one-shot query that
 * stays open is a leak, and every caller wanting this helper wants that.
 */
export function subscribeOnce(
  subscribe: SubscribeFn,
  filters: NDKFilter[],
  handlers: OnceHandlers
): NDKSubscription {
  return subscribe(filters, { closeOnEose: true }, handlers);
}
