/**
 * @fileoverview Tests for useProfile: the read-before-write guard on kind:10002
 * and kind:0, keyed to the signed-in pubkey and signer, and saveRelays'
 * pool-before-publish ordering.
 *
 * A kind:10002 replaces the user's whole relay list on every relay and in every
 * Nostr app. Publishing one built from a list that was never read -- a read
 * still pending, failed, timed out, or done for a different key -- replaces
 * the real list. saveRelays refuses in every one of those states.
 *
 * Pool ordering: *
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
let currentPubkey = 'a'.repeat(64);
let currentSigner: object = { id: 'signer-a' };

/** Resolves to [metadata events, relay-list events] per call, or hangs/rejects. */
let fetchImpl: (filter: { kinds: number[]; authors: string[] }) => Promise<Set<unknown>>;

const relayListEvent = (urls: string[], created_at = 100) => ({
  kind: 10002,
  created_at,
  content: '',
  tags: urls.map((u) => ['r', u]),
});

/** A relay that answers: metadata absent, relay list as given (or none). */
function answering(relayUrls: string[] | null) {
  return async (filter: { kinds: number[] }) =>
    new Set(filter.kinds[0] === 10002 && relayUrls ? [relayListEvent(relayUrls)] : []);
}

const mockFetchEvents = vi.fn((filter: { kinds: number[]; authors: string[] }) => fetchImpl(filter));

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({
    subscribe: vi.fn(),
    service: mockService,
    publish: mockPublish,
    createEvent: mockCreateEvent,
    isConnected: connected,
    fetchEvents: mockFetchEvents,
    fetchFromOwnRelays: vi.fn().mockResolvedValue(new Set()),
  }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: (s: { pubkey: string; isAuthenticated: boolean }) => unknown) => {
    const state = { pubkey: currentPubkey, isAuthenticated: true };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ signer: currentSigner }),
}));

const { useProfile } = await import('./useProfile');

beforeEach(() => {
  callOrder.length = 0;
  mockPublish.mockClear();
  mockCreateEvent.mockClear();
  mockService.setConfiguredRelays.mockClear();
  mockAuthPolicy.setTrustedRelays.mockClear();
  mockFetchEvents.mockClear();
  connected = true;
  currentPubkey = 'a'.repeat(64);
  currentSigner = { id: 'signer-a' };
  fetchImpl = answering(['wss://existing.example.com']);
});

/** Render and let the initial read settle. */
async function renderLoaded() {
  const hook = renderHook(() => useProfile());
  await act(async () => {
    await Promise.resolve();
  });
  await vi.waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

const NEW_ENTRY = { url: 'wss://new.example.com', read: true, write: true };

async function expectRefused(save: () => Promise<void>) {
  let thrown: unknown;
  await act(async () => {
    try {
      await save();
    } catch (err) {
      thrown = err;
    }
  });
  expect(thrown).toBeInstanceOf(Error);
  expect(mockPublish).not.toHaveBeenCalled();
  expect(mockService.setConfiguredRelays).not.toHaveBeenCalled();
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pool-before-publish ordering
// ---------------------------------------------------------------------------

describe('useProfile.saveRelays', () => {
  it('calls setConfiguredRelays before publish so declared relays are in the pool', async () => {
    const { result } = await renderLoaded();

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
    const { result } = await renderLoaded();

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

describe('useProfile.saveRelays read-before-write guard', () => {
  it('refuses while the relay list has not been read yet', async () => {
    fetchImpl = () => new Promise(() => {});
    const { result } = renderHook(() => useProfile());
    await expectRefused(() => result.current.saveRelays([NEW_ENTRY]));
  });

  it('refuses when the read failed', async () => {
    fetchImpl = async () => {
      throw new Error('relay unreachable');
    };
    const { result } = await renderLoaded();
    expect(result.current.relayList?.status).toBe('unreadable');
    await expectRefused(() => result.current.saveRelays([NEW_ENTRY]));
  });

  it('refuses when not connected to any relay', async () => {
    connected = false;
    const { result } = await renderLoaded();
    await expectRefused(() => result.current.saveRelays([NEW_ENTRY]));
  });

  it('treats a read that never answers as an error, not as an empty list', async () => {
    vi.useFakeTimers();
    try {
      fetchImpl = () => new Promise(() => {});
      const { result } = renderHook(() => useProfile());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(result.current.relayList?.status).toBe('unreadable');
      expect(result.current.relays).toEqual([]);
      await expectRefused(() => result.current.saveRelays([NEW_ENTRY]));
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows a save once the list was read, and shows what was read', async () => {
    const { result } = await renderLoaded();
    expect(result.current.relayList?.status).toBe('found');
    expect(result.current.relays.map((r) => r.url)).toEqual(['wss://existing.example.com']);
    await act(async () => {
      await result.current.saveRelays([...result.current.relays, NEW_ENTRY]);
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it('allows creating a first list when a relay answered and the user has none', async () => {
    fetchImpl = answering(null);
    const { result } = await renderLoaded();
    expect(result.current.relayList?.status).toBe('absent');
    await act(async () => {
      await result.current.saveRelays([NEW_ENTRY]);
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it('after a key switch, does not show or save under the new key until the new key is read', async () => {
    const hook = await renderLoaded();
    expect(hook.result.current.relays).toHaveLength(1);

    fetchImpl = () => new Promise(() => {});
    currentPubkey = 'b'.repeat(64);
    currentSigner = { id: 'signer-b' };
    hook.rerender();

    expect(hook.result.current.relays).toEqual([]);
    expect(hook.result.current.relayList).toBeNull();
    await expectRefused(() => hook.result.current.saveRelays([NEW_ENTRY]));
  });

  it('a signer change for the same pubkey also requires a fresh read', async () => {
    const hook = await renderLoaded();
    fetchImpl = () => new Promise(() => {});
    currentSigner = { id: 'signer-a-reconnected' };
    hook.rerender();
    await expectRefused(() => hook.result.current.saveRelays([NEW_ENTRY]));
  });

  it("a slow read for the previous key cannot unlock the new key's save", async () => {
    let resolveA!: (v: Set<unknown>) => void;
    fetchImpl = (filter) =>
      filter.kinds[0] === 10002
        ? new Promise((r) => {
            resolveA = r;
          })
        : Promise.resolve(new Set());
    const hook = renderHook(() => useProfile());
    await vi.waitFor(() => expect(resolveA).toBeTypeOf('function'));

    fetchImpl = () => new Promise(() => {});
    currentPubkey = 'b'.repeat(64);
    currentSigner = { id: 'signer-b' };
    hook.rerender();

    await act(async () => {
      resolveA(new Set([relayListEvent(['wss://a-only.example.com'])]));
      await Promise.resolve();
    });
    expect(hook.result.current.relays).toEqual([]);
    await expectRefused(() => hook.result.current.saveRelays([NEW_ENTRY]));
  });
});

describe('useProfile.saveProfile is keyed the same way', () => {
  it("refuses after a key switch even though the previous key's profile was read", async () => {
    const hook = await renderLoaded();
    expect(hook.result.current.existing?.status).toBe('absent');
    fetchImpl = () => new Promise(() => {});
    currentPubkey = 'b'.repeat(64);
    currentSigner = { id: 'signer-b' };
    hook.rerender();
    await expectRefused(() => hook.result.current.saveProfile({ name: 'x' }));
  });
});

describe('useProfile loading state', () => {
  it('a connection drop during a read does not leave the form loading forever', async () => {
    fetchImpl = () => new Promise(() => {});
    const hook = renderHook(() => useProfile());
    await vi.waitFor(() => expect(hook.result.current.isLoading).toBe(true));

    connected = false;
    hook.rerender();

    await vi.waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.relayList?.status).toBe('unreadable');
  });

  it("a save that finishes after a key switch is not recorded as the new key's list", async () => {
    let finishPublish!: () => void;
    mockPublish.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPublish = () => resolve(new Set());
        })
    );
    const hook = await renderLoaded();
    let saving!: Promise<void>;
    act(() => {
      saving = hook.result.current.saveRelays([NEW_ENTRY]);
    });
    await vi.waitFor(() => expect(finishPublish).toBeTypeOf('function'));

    fetchImpl = () => new Promise(() => {});
    currentPubkey = 'b'.repeat(64);
    currentSigner = { id: 'signer-b' };
    hook.rerender();

    await act(async () => {
      finishPublish();
      await saving;
    });
    expect(hook.result.current.relayList).toBeNull();
    expect(hook.result.current.relays).toEqual([]);
  });
});
