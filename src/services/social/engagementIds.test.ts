/**
 * @fileoverview Tests for the engagement id set.
 *
 * This guards a performance property that has no visible symptom in the UI and
 * a very visible one in the relay's logs.
 *
 * The id set is a dependency of the engagement subscription effect. Deriving it
 * straight from `notes` meant it changed on every arriving note, so the effect's
 * cleanup ran sub.stop() per note -- tearing down and rebuilding the
 * subscription up to fifty times during a single feed load, each teardown
 * cancelling a query the relay was mid-way through executing:
 *
 *   failed to fetch events using query "... tagvalues && ARRAY[$2..$41] ..."
 *     : context canceled
 *
 * Two things prevent that now, and only one of them is here. useCoalesced
 * settles the set on a trailing edge (tested in useCoalesced.test.ts); this
 * function makes a settle tick FREE when nothing actually changed, by returning
 * the same array rather than an equal one.
 */

import { describe, it, expect } from 'vitest';
import { nextEngagementIds } from './useFeed';

const notes = (...ids: string[]) => ids.map((id) => ({ id }));

describe('nextEngagementIds', () => {
  it('returns the SAME array when the ids are unchanged', () => {
    // toBe, not toEqual. An equal-but-new array is a new dependency identity,
    // which resubscribes -- the exact cost this removes. Equality is not enough.
    const prev = ['a', 'b', 'c'];

    expect(nextEngagementIds(prev, notes('a', 'b', 'c'))).toBe(prev);
  });

  it('returns a new array when a note is prepended', () => {
    const prev = ['a', 'b'];
    const next = nextEngagementIds(prev, notes('new', 'a', 'b'));

    expect(next).not.toBe(prev);
    expect(next).toEqual(['new', 'a', 'b']);
  });

  it('returns a new array when a note is removed', () => {
    const prev = ['a', 'b', 'c'];

    expect(nextEngagementIds(prev, notes('a', 'b'))).toEqual(['a', 'b']);
  });

  it('notices reordering even at the same length', () => {
    // A cheap length check alone would miss this, and the subscription would
    // keep tracking a stale set.
    const prev = ['a', 'b'];
    const next = nextEngagementIds(prev, notes('b', 'a'));

    expect(next).not.toBe(prev);
    expect(next).toEqual(['b', 'a']);
  });

  it('tracks at most fifty notes', () => {
    const many = notes(...Array.from({ length: 80 }, (_, i) => `n${i}`));

    expect(nextEngagementIds([], many)).toHaveLength(50);
  });

  it('is stable across repeated calls on a settled feed', () => {
    // The real scenario: the feed stops moving and the coalescer keeps ticking.
    // Every tick after the first must be free.
    const feed = notes('a', 'b', 'c');
    const first = nextEngagementIds([], feed);
    const second = nextEngagementIds(first, feed);
    const third = nextEngagementIds(second, feed);

    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('handles an empty feed', () => {
    const prev: string[] = [];
    expect(nextEngagementIds(prev, [])).toBe(prev);
  });
});
