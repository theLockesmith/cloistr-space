/**
 * @fileoverview Coalesce a burst of relay events into one render.
 *
 * Every relay subscription in this app has the same shape: a handler that fires
 * once per incoming event and updates React state. That is fine at one event a
 * second and pathological at fifty, and the difference is not visible at the
 * call site.
 *
 * It bit us concretely. The engagement subscription called setNotes from
 * onEvent, mapping every note in the feed each time. Under the outbox model the
 * same reaction arrives from every relay that holds it, and PUBLISHING one
 * guarantees the echo comes back from every relay that accepted it -- so the
 * action that triggered the storm was the action the user had just taken, and
 * the feed locked up at the exact moment they tapped. An idle feed never showed
 * it.
 *
 * React 18 batches updates inside one event handler. It does NOT batch across
 * separate WebSocket messages, because each arrives in its own task. So a burst
 * of N events is N renders unless something explicitly coalesces them.
 *
 * Use this for ANY per-event state update driven by a subscription.
 */

import { useCallback, useEffect, useRef } from 'react';

/** Long enough to absorb a relay burst, short enough to feel immediate. */
const DEFAULT_WINDOW_MS = 120;

/**
 * Returns a function that runs `fn` at most once per window, on the trailing
 * edge.
 *
 * Trailing rather than leading on purpose: the point is to render the SETTLED
 * result of a burst, and a leading call would render the first event's state
 * and then need a second pass anyway.
 *
 * The callback is read from a ref at flush time, so a handler closing over
 * fresh state does not need this to be re-created -- and re-creating it would
 * reintroduce the churn it exists to prevent.
 */
export function useCoalesced(fn: () => void, windowMs = DEFAULT_WINDOW_MS): () => void {
  const fnRef = useRef(fn);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Assigned in an effect rather than during render. Writing a ref while
  // rendering is a real hazard under concurrent rendering, where a render can
  // be discarded -- the ref would keep the abandoned callback.
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback(() => {
    // Already scheduled: the burst is absorbed by the pending flush rather than
    // extending it, so a continuous stream still renders every windowMs instead
    // of never.
    if (timerRef.current) return;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      fnRef.current();
    }, windowMs);
  }, [windowMs]);
}
