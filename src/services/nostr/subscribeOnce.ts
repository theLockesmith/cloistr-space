/**
 * @fileoverview Nostr subscriptions that cannot lose their opening burst.
 *
 * NDK starts a subscription the moment you call subscribe() — index.d.ts:3373,
 * "Subscriptions automatically start unless autoStart is set to false". So this
 * sequence, which reads perfectly naturally:
 *
 *   const sub = subscribe(filters, opts);
 *   sub.on('event', ...);
 *   sub.start();
 *
 * has a window between subscribe() and the first .on() in which delivery is
 * dropped on the floor. The relay answers from storage as fast as it can, so
 * that window is usually where the stored events land.
 *
 * THE DISCRIMINATOR IS NOT closeOnEose.
 *
 * An earlier version of this comment said closeOnEose:false subscriptions were
 * safe because "more events follow". That rule is wrong, it was written down
 * confidently, and it caused a fix to be applied to the wrong layer — groups
 * still vanished on reload after a fix that was itself correct. A wrong rule in
 * a comment propagates further than the bug it describes, so state the right one
 * plainly:
 *
 *   Does this subscription's content ARRIVE ONCE, or does it KEEP ARRIVING?
 *
 *   HISTORICAL — the events exist already and no more will be written. The
 *   entire payload is the initial burst. Missing it loses everything,
 *   permanently, whatever closeOnEose says. kind:39001/39002 group membership
 *   is written once at group creation and never again: a closeOnEose:false
 *   subscription over those is exactly as fatal as a one-shot query.
 *
 *   ONGOING — new events keep being written. Missing the opening burst costs
 *   the history but the subscription recovers, so the bug is masked rather than
 *   absent. Group chat looks fine and silently shows only messages that arrive
 *   after you open it.
 *
 * Both are bugs. Ongoing is merely the quiet one. Route everything through these
 * helpers rather than deciding per call site which kind you have — that judgement
 * is what went wrong, and it is not a judgement worth making repeatedly.
 */

import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';

export interface OnceHandlers {
  onEvent?: (event: NDKEvent) => void;
  onEose?: () => void;
}

export interface StreamOptions {
  closeOnEose?: boolean;
  groupable?: boolean;
}

/**
 * The subset of NdkService.subscribe these need, so callers can pass either the
 * service method or a test double without dragging NDK's full type in.
 */
export type SubscribeFn = (
  filters: NDKFilter[],
  opts?: StreamOptions,
  handlers?: OnceHandlers
) => NDKSubscription;

/**
 * A single query whose result arrives and is done.
 *
 * closeOnEose is forced here rather than left to the caller: a one-shot query
 * that stays open is a leak, and every caller wanting this helper wants that.
 */
export function subscribeOnce(
  subscribe: SubscribeFn,
  filters: NDKFilter[],
  handlers: OnceHandlers
): NDKSubscription {
  return subscribe(filters, { closeOnEose: true }, handlers);
}

/**
 * A subscription that stays open, but still needs everything already stored.
 *
 * closeOnEose is the CALLER'S choice here, deliberately — it is not the thing
 * that decides whether the opening burst matters. A group-membership
 * subscription wants to stay open so later joins arrive, and equally cannot
 * afford to miss the members who joined before it opened.
 */
export function subscribeStream(
  subscribe: SubscribeFn,
  filters: NDKFilter[],
  handlers: OnceHandlers,
  opts: StreamOptions = { closeOnEose: false }
): NDKSubscription {
  return subscribe(filters, opts, handlers);
}
