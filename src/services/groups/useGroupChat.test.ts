/**
 * @fileoverview Tests for useGroupChat relay routing.
 *
 * The change under test: useGroupChat now pins its subscription to the user's
 * own relays via service.getOwnRelaySet(). Without this, NDK routes the
 * kind:9 query to explicitRelayUrls (the no-authors branch), which happens to
 * be the same relay today but is not guaranteed. The subscription would
 * silently go to a relay that has never seen our group messages, and an empty
 * result looks identical to "no messages".
 *
 * See relayRouting.ts for the full per-kind routing manifest.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const fakeRelaySet = { relays: new Set(['wss://relay.cloistr.xyz']), urls: ['wss://relay.cloistr.xyz'] };

const stop = vi.fn();
const subscribe = vi.fn(
  (_filters: unknown[], _opts?: unknown, _handlers?: unknown) => ({
    stop,
    on: vi.fn(),
    start: vi.fn(),
  })
);

const mockService = {
  getOwnRelaySet: vi.fn(() => fakeRelaySet),
};

const createEvent = vi.fn(() => ({
  kind: 0,
  content: '',
  tags: [] as string[][],
  id: 'test-event-id',
}));

const publish = vi.fn().mockResolvedValue(undefined);

let connected = true;

vi.mock('@/services/nostr', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/services/nostr');
  return {
    ...actual,
    useNdk: () => ({
      subscribe,
      service: mockService,
      publish,
      createEvent,
      isConnected: connected,
    }),
  };
});

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    pubkey: 'a'.repeat(64),
    isAuthenticated: true,
  }),
}));

const { useGroupChat } = await import('./useGroupChat');

beforeEach(() => {
  vi.useFakeTimers();
  stop.mockClear();
  subscribe.mockClear();
  mockService.getOwnRelaySet.mockClear();
  publish.mockClear();
  createEvent.mockClear();
  connected = true;
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Relay routing
// ---------------------------------------------------------------------------

describe('useGroupChat relay routing', () => {
  it('passes relaySet from getOwnRelaySet to the subscription', async () => {
    // The assertion that matters. A relay set built and then not forwarded
    // looks identical to one that was never built, which is exactly how
    // dropped arguments in the subscribe path stay invisible.
    renderHook(() => useGroupChat('test-group'));

    // useGroupChat defers subscription via setTimeout(..., 0)
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(subscribe).toHaveBeenCalledTimes(1);

    // subscribe(filters, opts, handlers): the second arg carries relaySet.
    const opts = subscribe.mock.calls[0][1] as Record<string, unknown>;
    expect(opts).toBeDefined();
    expect(opts.relaySet).toBe(fakeRelaySet);
  });

  it('calls getOwnRelaySet to build the relay set', async () => {
    renderHook(() => useGroupChat('test-group'));

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(mockService.getOwnRelaySet).toHaveBeenCalled();
  });

  it('sets closeOnEose to false for an ongoing chat subscription', async () => {
    renderHook(() => useGroupChat('test-group'));

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    const opts = subscribe.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.closeOnEose).toBe(false);
  });

  it('does not subscribe when disconnected', async () => {
    connected = false;
    renderHook(() => useGroupChat('test-group'));

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(subscribe).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

describe('useGroupChat message handling', () => {
  it('filters out events for other groups', async () => {
    // Make subscribe capture the onEvent handler so we can call it manually.
    let onEvent: ((event: unknown) => void) | undefined;
    subscribe.mockImplementation((_filters, _opts, handlers) => {
      onEvent = (handlers as { onEvent?: (e: unknown) => void })?.onEvent;
      return { stop, on: vi.fn(), start: vi.fn() };
    });

    const { result } = renderHook(() => useGroupChat('my-group'));

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(onEvent).toBeDefined();

    // Deliver an event for a DIFFERENT group.
    act(() => {
      onEvent!({
        id: 'evt-1',
        pubkey: 'b'.repeat(64),
        content: 'hello',
        tags: [['h', 'other-group']],
        created_at: 1000,
      });
    });

    expect(result.current.messages).toHaveLength(0);

    // Deliver an event for the CORRECT group.
    act(() => {
      onEvent!({
        id: 'evt-2',
        pubkey: 'b'.repeat(64),
        content: 'world',
        tags: [['h', 'my-group']],
        created_at: 1001,
      });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe('world');
  });
});
