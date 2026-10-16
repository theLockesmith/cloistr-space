/**
 * @fileoverview Telling "nothing here" from "could not ask".
 *
 * Every Activity widget rendered "No files", "No tasks", "No mentions" both
 * when the user had none AND when no relay answered or Space was not
 * connected at all -- and while not connected it showed a skeleton forever.
 * Those are different facts (spec AV3, RD6), and the second kind must never
 * read as the first.
 *
 * A widget read ends in exactly one of: items, empty (a relay answered with
 * nothing), or an error naming why it could not ask.
 */

import { useEffect, useState } from 'react';

/** How long a read may go without any relay answering before it has failed. */
export const WIDGET_NO_ANSWER_MS = 15_000;

export const NO_RELAY_ANSWERED = 'None of your relays answered. Check your connection and try again.';
export const NOT_CONNECTED = 'Not connected to any relay. Check your connection and try again.';

interface EoseInfo {
  eosesSeen?: Set<unknown>;
}

/**
 * Whether any relay sent end-of-results. NDK passes the subscription to
 * onEose and fires it even when every relay failed; `eosesSeen` is what says
 * whether anyone actually answered. A caller that passes nothing gives no
 * evidence either way, so it counts as answered rather than inventing a
 * failure.
 */
export function relaysAnswered(sub?: EoseInfo): boolean {
  return sub?.eosesSeen === undefined || sub.eosesSeen.size > 0;
}

interface Handlers<E> {
  onEvent?: (event: E) => void;
  onEose?: () => void;
}

/**
 * Wrap a widget's subscription handlers so a read nobody answers ends in
 * `onNoAnswer` rather than an endless skeleton or a false "nothing here".
 * Fires when EOSE arrives with no relay having answered, or when neither an
 * event nor EOSE arrives within WIDGET_NO_ANSWER_MS. Any event counts as an
 * answer. `cancel` must be called when the subscription stops.
 */
export function trackAnswers<E>(
  handlers: Handlers<E>,
  onNoAnswer: () => void
): { handlers: { onEvent: (event: E) => void; onEose: (sub?: EoseInfo) => void }; cancel: () => void } {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    onNoAnswer();
  }, WIDGET_NO_ANSWER_MS);
  const settle = () => {
    settled = true;
    clearTimeout(timer);
  };
  return {
    handlers: {
      onEvent: (event: E) => {
        settle();
        handlers.onEvent?.(event);
      },
      onEose: (sub?: EoseInfo) => {
        const first = !settled;
        settle();
        if (first && !relaysAnswered(sub)) onNoAnswer();
        else handlers.onEose?.();
      },
    },
    cancel: settle,
  };
}

/**
 * True once Space has been disconnected from every relay for
 * WIDGET_NO_ANSWER_MS without a break. Before that, a widget that is not
 * connected is still connecting and shows its loading state.
 */
export function useUnreachable(isConnected: boolean): boolean {
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    if (isConnected) {
      const reset = setTimeout(() => setUnreachable(false), 0);
      return () => clearTimeout(reset);
    }
    const timer = setTimeout(() => setUnreachable(true), WIDGET_NO_ANSWER_MS);
    return () => clearTimeout(timer);
  }, [isConnected]);
  return unreachable && !isConnected;
}

/**
 * The state a widget shows: its own, unless Space cannot reach any relay and
 * the widget has nothing to show, in which case it says so.
 */
export function withReachability<S extends { items: unknown[]; isLoading: boolean; error: string | null }>(
  state: S,
  unreachable: boolean
): S {
  if (!unreachable || state.items.length > 0) return state;
  return { ...state, isLoading: false, error: NOT_CONNECTED };
}
