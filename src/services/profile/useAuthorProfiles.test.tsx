/**
 * @fileoverview Tests for author-profile resolution.
 *
 * The bug these exist for was a React lifecycle trap rather than anything to do
 * with Nostr: the effect keyed on the list of not-yet-requested authors, which
 * EMPTIES the instant those authors are marked requested. The dep changed, React
 * ran the cleanup, and `sub.stop()` killed the subscription before any kind:0
 * arrived.
 *
 * Self-triggering, and therefore total rather than intermittent: the first
 * profile that did land called setProfiles, which re-rendered, which emptied the
 * list again. The feature presented exactly as if it had never been wired, which
 * is why it survived one deploy and could not be diagnosed from the bundle.
 *
 * The first test fails against that version and passes now.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

interface AuthorFilter {
  kinds: number[];
  authors: string[];
}

const stop = vi.fn();
// Typed explicitly: an inferred zero-arg mock makes every mock.calls[n][0]
// access a type error, and casting each one would hide real shape mistakes.
const subscribe = vi.fn(
  (_filters: AuthorFilter[], _opts?: unknown, _handlers?: unknown) => ({
    stop,
    on: vi.fn(),
    start: vi.fn(),
  })
);
let connected = true;

vi.mock('@/services/nostr', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/services/nostr');
  return {
    ...actual,
    useNdk: () => ({ subscribe, isConnected: connected }),
  };
});

const { useAuthorProfiles } = await import('./useAuthorProfiles');

beforeEach(() => {
  stop.mockClear();
  subscribe.mockClear();
  connected = true;
});

describe('useAuthorProfiles', () => {
  it('subscribes once for all authors, not once per author', () => {
    // Under the outbox model each subscription fans out across that author's
    // own relays, so per-author subscriptions multiply connections rather than
    // adding them.
    renderHook(({ keys }) => useAuthorProfiles(keys), {
      initialProps: { keys: ['a', 'b', 'c'] },
    });

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0][0][0].authors).toEqual(['a', 'b', 'c']);
  });

  it('DOES NOT stop the subscription when the author list empties', () => {
    // The regression. Re-rendering with the same authors makes `unresolved`
    // empty, because they are now marked requested -- and the previous version
    // treated that dep change as a reason to tear the subscription down.
    const { rerender } = renderHook(({ keys }) => useAuthorProfiles(keys), {
      initialProps: { keys: ['a', 'b'] },
    });

    expect(subscribe).toHaveBeenCalledTimes(1);

    // A new array with identical contents, which is what a feed re-render
    // produces on every engagement update.
    rerender({ keys: ['a', 'b'] });

    expect(stop, 'subscription was torn down while waiting for kind:0').not.toHaveBeenCalled();
  });

  it('does not re-request authors it has already asked about', () => {
    const { rerender } = renderHook(({ keys }) => useAuthorProfiles(keys), {
      initialProps: { keys: ['a', 'b'] },
    });

    rerender({ keys: ['a', 'b'] });
    rerender({ keys: ['a', 'b'] });

    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('subscribes again for authors it has not seen before', () => {
    // Scrolling brings new authors into view; they need their own query, and
    // the earlier subscription must survive it.
    const { rerender } = renderHook(({ keys }) => useAuthorProfiles(keys), {
      initialProps: { keys: ['a'] },
    });

    rerender({ keys: ['a', 'b'] });

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(
      subscribe.mock.calls[1][0][0].authors,
      'should only ask about the NEW author'
    ).toEqual(['b']);
    expect(stop).not.toHaveBeenCalled();
  });

  it('stops every subscription on unmount', () => {
    const { rerender, unmount } = renderHook(({ keys }) => useAuthorProfiles(keys), {
      initialProps: { keys: ['a'] },
    });
    rerender({ keys: ['a', 'b'] });

    expect(subscribe).toHaveBeenCalledTimes(2);

    unmount();

    // Both, not just the last one -- collecting subscriptions is only safe if
    // all of them are released.
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('does not subscribe while disconnected', () => {
    connected = false;
    renderHook(({ keys }) => useAuthorProfiles(keys), { initialProps: { keys: ['a'] } });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('re-requests authors after a reconnect', async () => {
    // A subscription bound to a dead connection will never deliver. Clearing
    // the requested set is what stops a reconnect turning into permanently
    // missing avatars.
    connected = false;
    const { rerender } = renderHook(({ keys }) => useAuthorProfiles(keys), {
      initialProps: { keys: ['a'] },
    });
    expect(subscribe).not.toHaveBeenCalled();

    await act(async () => {
      connected = true;
    });
    rerender({ keys: ['a'] });

    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
