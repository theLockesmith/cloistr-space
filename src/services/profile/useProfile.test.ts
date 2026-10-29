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
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

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
  getRelaySetFor: (urls: string[]) => ({ urls }),
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
// One relay per subscription, as useProfile asks each relay separately (the
// user's write relays for kind:0, the public indexers for kind:10002). Every
// relay answers with nothing unless a test sets `indexer`: 'holds' returns
// `indexerList` for kind:10002, 'silent' never answers.
let indexer: 'empty' | 'holds' | 'silent' = 'empty';
let indexerList: unknown = null;
// Stable across renders: useProfile's read depends on it, and a fresh one per
// render would rerun the read forever.
const mockSubscribe = vi.fn(
  (
    filters: { kinds: number[] }[],
    opts: { relaySet?: { urls: string[] } },
    handlers: { onEvent?: (e: unknown) => void; onEose?: () => void },
  ) => {
    const url = opts.relaySet?.urls[0];
    const sub = { eosesSeen: new Set<{ url?: string }>(), stop: vi.fn() };
    const forRelayList = filters[0]?.kinds.includes(10002);
    if (forRelayList && indexer === 'silent') return sub;
    queueMicrotask(() => {
      if (forRelayList && indexer === 'holds') handlers.onEvent?.(indexerList);
      sub.eosesSeen.add({ url });
      handlers.onEose?.();
    });
    return sub;
  },
);

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

const meSk = generateSecretKey();
const ME = getPublicKey(meSk);
const oldList = finalizeEvent({ kind: 10002, created_at: 1, content: '', tags: [['r', 'wss://old.example.com']] }, meSk);
const authState = { pubkey: ME, isAuthenticated: true };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

const { useProfile, OWN_RELAY_PROFILE_TIMEOUT_MS } = await import('./useProfile');

beforeEach(() => {
  callOrder.length = 0;
  mockPublish.mockClear();
  mockCreateEvent.mockClear();
  mockService.setConfiguredRelays.mockClear();
  mockAuthPolicy.setTrustedRelays.mockClear();
  connected = true;
  authState.pubkey = ME;
  indexer = 'empty';
  indexerList = null;
  mockFetchEvents = vi.fn(async (..._args: unknown[]) => new Set());
});

/** Render and let the initial read settle. */
async function renderSettled() {
  const hook = renderHook(() => useProfile());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
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
      return new Set([oldList]);
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
  // it, and here that read throws. That failure must not mark the relay list,
  // which was read fine, as unreadable.
  it('allows the save once the current list was read, even if the profile read after it failed', async () => {
    mockFetchEvents = vi.fn(async (...args: unknown[]) => {
      const filter = args[0] as { kinds: number[] };
      if (!filter.kinds.includes(10002)) return new Set();
      return new Set([oldList]);
    });
    mockSubscribe.mockImplementationOnce(() => {
      throw new Error('relay closed');
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

// ---------------------------------------------------------------------------
// The public indexers (review of !263)
//
// Space's own relays answering with no kind:10002 does not mean the user has
// none: it may live only on relays Space cannot reach. Before calling it
// absent, the read asks the public relay-list indexers.
// ---------------------------------------------------------------------------

describe('useProfile relay list when Space\'s own relays have none', () => {
  const kept = finalizeEvent({ kind: 10002, created_at: 5, content: '', tags: [['r', 'wss://elsewhere.example.com']] }, meSk);

  it('uses the list an indexer holds, so a save keeps it', async () => {
    indexer = 'holds';
    indexerList = kept;
    const { result } = await renderSettled();

    expect(result.current.relayListRead).toBe('found');
    expect(result.current.relays.map((r) => r.url)).toEqual(['wss://elsewhere.example.com']);
  });

  it('is absent when the indexers answered with nothing, so a first list can be saved', async () => {
    const { result } = await renderSettled();

    expect(result.current.relayListRead).toBe('absent');
    await act(async () => {
      await result.current.saveRelays(ADDED);
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  // A directory relay's answer is re-signed as the user by the next save, so
  // an unchecked one would let its operator choose which relays the user
  // endorses. A forgery is no answer at all: not found, and not absent either.
  it('a forged list from an indexer is no answer: nothing shown, and the save is refused', async () => {
    indexer = 'holds';
    indexerList = { ...kept, tags: [['r', 'wss://attacker.example.com']] };
    const { result } = await renderSettled();

    expect(result.current.relays).toEqual([]);
    expect(result.current.relayListRead).toBe('unreadable');
    await act(async () => {
      await expect(result.current.saveRelays(ADDED)).rejects.toThrow(/relay list/i);
    });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('a list signed by some other key under the user\'s name is no answer either', async () => {
    indexer = 'holds';
    indexerList = { ...finalizeEvent({ kind: 10002, created_at: 5, content: '', tags: [['r', 'wss://attacker.example.com']] }, generateSecretKey()), pubkey: ME };
    const { result } = await renderSettled();

    expect(result.current.relays).toEqual([]);
    expect(result.current.relayListRead).toBe('unreadable');
  });

  // Space's pool asks the same indexers (outbox model), and NDK checks only a
  // sample of signatures once a relay is trusted (review of !263).
  it("a forged list from Space's own pool is not used, and the save is refused", async () => {
    const forged = { ...kept, tags: [['r', 'wss://attacker.example.com']] };
    mockFetchEvents = vi.fn(async (...args: unknown[]) => {
      const filter = args[0] as { kinds: number[] };
      return new Set(filter.kinds.includes(10002) ? [forged] : []);
    });
    const { result } = await renderSettled();

    expect(result.current.relays).toEqual([]);
    expect(result.current.relayListRead).toBe('unreadable');
    await act(async () => {
      await expect(result.current.saveRelays(ADDED)).rejects.toThrow(/relay list/i);
    });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("a forged list in the pool does not hide a genuine older one beside it", async () => {
    const forged = { ...finalizeEvent({ kind: 10002, created_at: 9, content: '', tags: [['r', 'wss://attacker.example.com']] }, meSk), tags: [['r', 'wss://attacker.example.com'], ['r', 'wss://x.example.com']] };
    mockFetchEvents = vi.fn(async (...args: unknown[]) => {
      const filter = args[0] as { kinds: number[] };
      return new Set(filter.kinds.includes(10002) ? [forged, kept] : []);
    });
    const { result } = await renderSettled();

    expect(result.current.relayListRead).toBe('found');
    expect(result.current.relays.map((r) => r.url)).toEqual(['wss://elsewhere.example.com']);
  });

  it("a forged profile from Space's own pool is not shown, and the profile save is refused", async () => {
    const real = finalizeEvent({ kind: 0, created_at: 3, content: JSON.stringify({ name: 'me' }), tags: [] }, meSk);
    const forged = { ...real, content: JSON.stringify({ name: 'forged', lud16: 'thief@example.com' }) };
    mockFetchEvents = vi.fn(async (...args: unknown[]) => {
      const filter = args[0] as { kinds: number[] };
      return new Set(filter.kinds.includes(10002) ? [] : [forged]);
    });
    const { result } = await renderSettled();

    expect(result.current.profile.name).toBeUndefined();
    expect(result.current.existing?.status).toBe('unreadable');
  });

  it('is unreadable when no indexer answers, and the save is refused', async () => {
    vi.useFakeTimers();
    try {
      indexer = 'silent';
      const { result } = renderHook(() => useProfile());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OWN_RELAY_PROFILE_TIMEOUT_MS + 10);
      });

      expect(result.current.relayListRead).toBe('unreadable');
      await act(async () => {
        await expect(result.current.saveRelays(ADDED)).rejects.toThrow(/relay list/i);
      });
      expect(mockPublish).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Account switch (review of !263)
//
// After a switch from A to B, A's late answer must not become B's profile or
// relay list: a save would then publish A's data signed by B.
// ---------------------------------------------------------------------------

describe('useProfile after an account switch', () => {
  const bSk = generateSecretKey();
  const B = getPublicKey(bSk);
  const keyOf = (who: string) => (who === B ? bSk : meSk);
  const letterOf = (who: string) => (who === B ? 'b' : 'a');
  const listOf = (who: string) =>
    finalizeEvent({ kind: 10002, created_at: 1, content: '', tags: [['r', `wss://${letterOf(who)}.example.com`]] }, keyOf(who));
  const profileOf = (who: string) =>
    finalizeEvent({ kind: 0, created_at: 1, content: JSON.stringify({ name: `user-${letterOf(who)}` }), tags: [] }, keyOf(who));

  /** Every fetch waits until its author's answer is released. */
  function heldFetches() {
    const release: Record<string, () => void> = {};
    const gates: Record<string, Promise<void>> = {};
    for (const who of [ME, B]) {
      gates[who] = new Promise<void>((r) => (release[who] = r));
    }
    mockFetchEvents = vi.fn(async (...args: unknown[]) => {
      const filter = args[0] as { kinds: number[]; authors: string[] };
      const who = filter.authors[0];
      await gates[who];
      return new Set([filter.kinds.includes(10002) ? listOf(who) : profileOf(who)]);
    });
    return release;
  }

  async function flush() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("A's answer landing while B's read is in flight is dropped", async () => {
    const release = heldFetches();
    const hook = renderHook(() => useProfile());
    await flush();

    authState.pubkey = B;
    hook.rerender();
    await flush();

    release[ME]();
    await flush();

    // Still waiting on B: nothing read, nothing saveable.
    expect(hook.result.current.relayListRead).toBeNull();
    expect(hook.result.current.relays).toEqual([]);
    expect(hook.result.current.profile.name).toBeUndefined();
    await act(async () => {
      await expect(hook.result.current.saveRelays(ADDED)).rejects.toThrow(/relay list/i);
    });
    expect(mockPublish).not.toHaveBeenCalled();

    release[B]();
    await flush();
    expect(hook.result.current.relays.map((r) => r.url)).toEqual(['wss://b.example.com']);
    expect(hook.result.current.profile.name).toBe('user-b');
  });

  it("A's answer landing after B's read settled does not replace B's", async () => {
    const release = heldFetches();
    const hook = renderHook(() => useProfile());
    await flush();

    authState.pubkey = B;
    hook.rerender();
    await flush();

    release[B]();
    await flush();
    expect(hook.result.current.relayListRead).toBe('found');

    release[ME]();
    await flush();

    expect(hook.result.current.relays.map((r) => r.url)).toEqual(['wss://b.example.com']);
    expect(hook.result.current.profile.name).toBe('user-b');
    expect(hook.result.current.existing?.status).toBe('found');
  });

  it("B's relays are not shown while A's read is in flight", async () => {
    mockFetchEvents = vi.fn(async (...args: unknown[]) => {
      const filter = args[0] as { kinds: number[]; authors: string[] };
      const who = filter.authors[0];
      if (who === ME) return new Promise<Set<unknown>>(() => {});
      return new Set([filter.kinds.includes(10002) ? listOf(who) : profileOf(who)]);
    });
    authState.pubkey = B;
    const hook = await renderSettled();
    expect(hook.result.current.relays.map((r) => r.url)).toEqual(['wss://b.example.com']);

    authState.pubkey = ME;
    hook.rerender();
    await flush();

    expect(hook.result.current.relays).toEqual([]);
  });

  it('a found answer for A does not carry over as found for B', async () => {
    mockFetchEvents = vi.fn(async (...args: unknown[]) => {
      const filter = args[0] as { kinds: number[]; authors: string[] };
      const who = filter.authors[0];
      if (who === B) return new Promise<Set<unknown>>(() => {});
      return new Set([filter.kinds.includes(10002) ? listOf(who) : profileOf(who)]);
    });
    const hook = await renderSettled();
    expect(hook.result.current.relayListRead).toBe('found');

    authState.pubkey = B;
    hook.rerender();
    await flush();

    expect(hook.result.current.relayListRead).toBeNull();
    expect(hook.result.current.existing).toBeNull();
    await act(async () => {
      await expect(hook.result.current.saveRelays(ADDED)).rejects.toThrow(/relay list/i);
    });
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
