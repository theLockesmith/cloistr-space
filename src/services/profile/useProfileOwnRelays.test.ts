/**
 * @fileoverview Sweep #6: a profile that lives only on the user's own relays
 * must not read as "absent".
 *
 * kind:0 is replaceable: a save publishes the whole profile. useProfile read
 * it from Space's connected relays only, so for a user whose profile is on
 * their own NIP-65 write relays the read came back empty, was recorded as
 * `absent`, and the next save published a profile built from the form alone,
 * wiping every field set in other apps.
 *
 * Now an empty read is checked against the user's write relays: found there
 * is `found`; a write relay that answered with nothing is `absent`; none of
 * them answering is `unreadable`, and the save is refused.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const ME = 'a'.repeat(64);
const W = 'wss://mine.example/';

const env = vi.hoisted(() => ({
  mode: 'holds' as 'holds' | 'empty' | 'silent',
  relayList: true,
  published: [] as { kind: number; content: string }[],
  asked: [] as string[][],
}));

const relayListEvent = () => ({
  kind: 10002,
  pubkey: ME,
  created_at: 10,
  content: '',
  tags: [['r', W, 'write']],
});
const ownProfile = {
  kind: 0,
  pubkey: ME,
  created_at: 20,
  content: JSON.stringify({ name: 'me', website: 'https://me.example' }),
  tags: [],
};

vi.mock('@/services/nostr', () => {
  // One stable object, as the real provider's memoised value is.
  const ndk = {
    isConnected: true,
    // Space's own pool: no kind:0 there.
    fetchEvents: async (filter: { kinds: number[] }) =>
      new Set(filter.kinds.includes(10002) && env.relayList ? [relayListEvent()] : []),
    subscribe: (
      _filters: unknown,
      opts: { relaySet?: { urls: string[] } },
      handlers: { onEvent?: (e: unknown) => void; onEose?: () => void }
    ) => {
      env.asked.push(opts.relaySet?.urls ?? []);
      const sub = { eosesSeen: new Set<unknown>(), stop: vi.fn() };
      if (env.mode !== 'silent') {
        queueMicrotask(() => {
          if (env.mode === 'holds') handlers.onEvent?.(ownProfile);
          sub.eosesSeen.add({ url: W });
          handlers.onEose?.();
        });
      }
      return sub;
    },
    service: { getRelaySetFor: (urls: string[]) => ({ urls }) },
    createEvent: () => ({ kind: 0, content: '', tags: [] as string[][] }),
    publish: async (e: { kind: number; content: string }) => {
      env.published.push({ kind: e.kind, content: e.content });
      return new Set([1]);
    },
  };
  return { useNdk: () => ndk };
});
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (sel?: (s: { pubkey: string }) => unknown) => (sel ? sel({ pubkey: ME }) : { pubkey: ME }),
}));

const { useProfile, OWN_RELAY_PROFILE_TIMEOUT_MS } = await import('./useProfile');

beforeEach(() => {
  env.mode = 'holds';
  env.relayList = true;
  env.published = [];
  env.asked = [];
});

async function loaded() {
  const hook = renderHook(() => useProfile());
  await waitFor(() => expect(hook.result.current.existing).not.toBeNull());
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

describe('a profile only on the user\'s own relays', () => {
  it('is found there, and a save keeps its fields', async () => {
    const { result } = await loaded();
    expect(env.asked).toContainEqual([W]);
    expect(result.current.existing?.status).toBe('found');

    await act(async () => {
      await result.current.saveProfile({ about: 'hello' });
    });
    const saved = JSON.parse(env.published.at(-1)!.content);
    expect(saved).toMatchObject({ name: 'me', website: 'https://me.example', about: 'hello' });
  });

  it('is absent when a write relay answered with nothing, so a first profile can be made', async () => {
    env.mode = 'empty';
    const { result } = await loaded();
    expect(result.current.existing?.status).toBe('absent');
    await act(async () => {
      await result.current.saveProfile({ name: 'new' });
    });
    expect(env.published).toHaveLength(1);
  });

  it('with no relay list, the pool\'s empty answer stays absent', async () => {
    env.relayList = false;
    const { result } = await loaded();
    expect(result.current.existing?.status).toBe('absent');
    expect(env.asked).toEqual([]);
  });
  it('is unreadable when none of the user\'s write relays answer, and the save is refused', async () => {
    vi.useFakeTimers();
    try {
      env.mode = 'silent';
      const hook = renderHook(() => useProfile());
      await act(async () => {
        await vi.advanceTimersByTimeAsync((OWN_RELAY_PROFILE_TIMEOUT_MS ?? 0) + 10);
      });
      expect(hook.result.current.existing?.status).toBe('unreadable');

      let refused: unknown = null;
      await act(async () => {
        await hook.result.current.saveProfile({ about: 'hello' }).catch((e: unknown) => {
          refused = e;
        });
      });
      expect(String(refused)).toMatch(/cancelled/);
      expect(env.published).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

