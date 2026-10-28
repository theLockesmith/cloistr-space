/**
 * @fileoverview Tests for useProfile.saveRelays pool-before-publish ordering.
 *
 * A new user's NDK pool contains only the default relay. saveRelays must add
 * the declared relays to the pool (via setConfiguredRelays) BEFORE publishing
 * the kind:10002, so the event reaches the relays the user just chose.
 * Without this, the publish goes to the default relay alone, which may refuse
 * a non-whitelisted pubkey, creating a permanent bootstrap deadlock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const callOrder: string[] = [];

const mockAuthPolicy = {
  setTrustedRelays: vi.fn(),
};

const mockService = {
  setConfiguredRelays: vi.fn((..._args: unknown[]) => {
    callOrder.push('setConfiguredRelays');
  }),
  getAuthPolicy: vi.fn(() => mockAuthPolicy),
};

const mockPublish = vi.fn(async () => {
  callOrder.push('publish');
  return new Set();
});

const mockCreateEvent = vi.fn(() => ({
  kind: 0,
  content: '',
  tags: [] as string[][],
  id: 'test-event-id',
}));

let connected = true;
// Stable across renders: useProfile's read depends on it, and a fresh one per
// render would rerun the read forever.
const mockSubscribe = vi.fn();

// The relay-list read. Defaults to "relays answered with nothing" so the
// ordering tests below run against a settled, safe-to-save read.
let mockFetchEvents = vi.fn(async (..._args: unknown[]) => new Set());

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({
    subscribe: mockSubscribe,
    service: mockService,
    publish: mockPublish,
    createEvent: mockCreateEvent,
    isConnected: connected,
    fetchEvents: mockFetchEvents,
    fetchFromOwnRelays: vi.fn().mockResolvedValue(new Set()),
  }),
}));

const authState = { pubkey: 'a'.repeat(64), isAuthenticated: true };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

const { useProfile } = await import('./useProfile');

beforeEach(() => {
  callOrder.length = 0;
  mockPublish.mockClear();
  mockCreateEvent.mockClear();
  mockService.setConfiguredRelays.mockClear();
  mockAuthPolicy.setTrustedRelays.mockClear();
  connected = true;
  mockFetchEvents = vi.fn(async (..._args: unknown[]) => new Set());
});

/** Render and let the initial read settle. */
async function renderSettled() {
  const hook = renderHook(() => useProfile());
  await act(async () => {
    await Promise.resolve();
  });
  return hook;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pool-before-publish ordering
// ---------------------------------------------------------------------------

describe('useProfile.saveRelays', () => {
  it('calls setConfiguredRelays before publish so declared relays are in the pool', async () => {
    const { result } = await renderSettled();

    const entries = [
      { url: 'wss://relay.example.com', read: true, write: true },
      { url: 'wss://backup.example.com', read: true, write: false },
    ];

    await act(async () => {
      await result.current.saveRelays(entries);
    });

    // setConfiguredRelays must have been called with the declared URLs.
    expect(mockService.setConfiguredRelays).toHaveBeenCalledWith([
      'wss://relay.example.com',
      'wss://backup.example.com',
    ]);

    // And it must have been called BEFORE publish.
    expect(callOrder).toEqual(['setConfiguredRelays', 'publish']);
  });

  it('publishes the kind:10002 event to whatever is now in the pool', async () => {
    const { result } = await renderSettled();

    const entries = [
      { url: 'wss://relay.example.com', read: true, write: true },
    ];

    await act(async () => {
      await result.current.saveRelays(entries);
    });

    // publish was called (the event reaches the now-expanded pool).
    expect(mockPublish).toHaveBeenCalledTimes(1);

    // The event should be kind:10002.
    const event = mockCreateEvent.mock.results[0]?.value;
    expect(event.kind).toBe(10002);
  });
});

// ---------------------------------------------------------------------------
// The clobber guard (board #274/#278)
//
// kind:10002 is replaceable: publishing it replaces the user's relay list in
// every Nostr app. The page starts from an empty draft, so a save made before
// the current list was read publishes just the relay the user typed and drops
// every other one.
// ---------------------------------------------------------------------------

const ADDED = [{ url: 'wss://new.example.com', read: true, write: true }];

describe('useProfile.saveRelays refuses to publish over a list it never read', () => {
  it('while the read is still in flight (cold load)', async () => {
    mockFetchEvents = vi.fn(() => new Promise<Set<unknown>>(() => {}));
    const { result } = renderHook(() => useProfile());

    await act(async () => {
      await expect(result.current.saveRelays(ADDED)).rejects.toThrow(/relay list/i);
    });

    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockService.setConfiguredRelays).not.toHaveBeenCalled();
  });

  it('when relays are unreachable', async () => {
    connected = false;
    const { result } = await renderSettled();

    await act(async () => {
      await expect(result.current.saveRelays(ADDED)).rejects.toThrow(/relay list/i);
    });

    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('when the read failed', async () => {
    mockFetchEvents = vi.fn(async () => {
      throw new Error('relay closed');
    });
    const { result } = await renderSettled();

    await act(async () => {
      await expect(result.current.saveRelays(ADDED)).rejects.toThrow(/relay list/i);
    });

    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('while a reread is in flight after an earlier read found a list', async () => {
    let call = 0;
    mockFetchEvents = vi.fn(async (...args: unknown[]) => {
      const filter = args[0] as { kinds: number[] };
      if (!filter.kinds.includes(10002)) return new Set();
      call += 1;
      if (call > 1) return new Promise<Set<unknown>>(() => {});
      return new Set([{ created_at: 1, tags: [['r', 'wss://old.example.com']] }]);
    });
    const { result } = await renderSettled();
    expect(result.current.relayListRead).toBe('found');

    await act(async () => {
      void result.current.reload();
      await Promise.resolve();
    });

    await act(async () => {
      await expect(result.current.saveRelays(ADDED)).rejects.toThrow(/relay list/i);
    });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  // The found list has a write relay, so load goes on to read the profile from
  // it, and this fake service cannot (no getRelaySetFor). That failure must
  // not mark the relay list, which was read fine, as unreadable.
  it('allows the save once the current list was read, even if the profile read after it failed', async () => {
    mockFetchEvents = vi.fn(async (...args: unknown[]) => {
      const filter = args[0] as { kinds: number[] };
      if (!filter.kinds.includes(10002)) return new Set();
      return new Set([{ created_at: 1, tags: [['r', 'wss://old.example.com']] }]);
    });
    const { result } = await renderSettled();

    expect(result.current.relayListRead).toBe('found');
    expect(result.current.relays.map((r) => r.url)).toEqual(['wss://old.example.com']);

    await act(async () => {
      await result.current.saveRelays([...result.current.relays, ...ADDED]);
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
  });
});
