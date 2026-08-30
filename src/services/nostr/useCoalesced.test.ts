/**
 * @fileoverview Tests for burst coalescing.
 *
 * This exists because of a lockup that only appeared at the moment the user
 * ACTED. The engagement subscription called setNotes from onEvent, mapping
 * every note in the feed each time; publishing a reaction brings the echo back
 * from every relay that accepted it, so the tap produced a burst of full-feed
 * re-renders and the UI froze. An idle feed never showed it, and the previous
 * version had been safe only because the subscription closed at eose before
 * duplicates could arrive.
 *
 * React 18 batches updates within one event handler but NOT across separate
 * WebSocket messages, since each arrives in its own task -- so N events are N
 * renders unless something explicitly coalesces them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCoalesced } from './useCoalesced';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useCoalesced', () => {
  it('collapses a burst into a single call', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useCoalesced(fn, 100));

    // Eleven relays delivering the same echo.
    act(() => {
      for (let i = 0; i < 11; i++) result.current();
    });

    expect(fn, 'should not have fired yet -- this is trailing edge').not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires on the trailing edge, not the leading one', () => {
    // Leading would render the FIRST event's state and then need a second pass
    // anyway. The point is to render the settled result of a burst.
    const fn = vi.fn();
    const { result } = renderHook(() => useCoalesced(fn, 100));

    act(() => result.current());
    expect(fn).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(fn).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps firing during a continuous stream rather than starving', () => {
    // A pending flush ABSORBS further calls rather than being pushed back by
    // them. Debounce-style extension would mean a busy feed never renders at
    // all, which is a worse bug than the one being fixed.
    const fn = vi.fn();
    const { result } = renderHook(() => useCoalesced(fn, 100));

    for (let window = 0; window < 3; window++) {
      act(() => {
        result.current();
        vi.advanceTimersByTime(50);
        result.current();
        vi.advanceTimersByTime(50);
      });
    }

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls the latest callback, not the one captured at mount', () => {
    // The handler closes over fresh state each render. Flushing a stale
    // closure would render data from whenever the hook first ran.
    const first = vi.fn();
    const second = vi.fn();

    const { result, rerender } = renderHook(({ fn }) => useCoalesced(fn, 100), {
      initialProps: { fn: first },
    });

    rerender({ fn: second });
    act(() => result.current());
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not fire after unmount', () => {
    // A pending flush calling setState on an unmounted component is a leak and
    // a warning; navigating away mid-burst is entirely ordinary.
    const fn = vi.fn();
    const { result, unmount } = renderHook(() => useCoalesced(fn, 100));

    act(() => result.current());
    unmount();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(fn).not.toHaveBeenCalled();
  });

  it('returns a stable function across renders', () => {
    // Callers put this in effect dependency arrays. An unstable identity would
    // re-run those effects constantly -- re-subscribing to relays, which is the
    // churn this whole area keeps suffering from.
    const { result, rerender } = renderHook(() => useCoalesced(() => {}, 100));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
