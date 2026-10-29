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
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

const meSk = generateSecretKey();
const ME = getPublicKey(meSk);
const W = 'wss://mine.example/';

const W2 = 'wss://second.example/';

type Behaviour = 'holds' | 'empty' | 'silent' | 'eoseWithoutRelay';

const env = vi.hoisted(() => ({
  /** Behaviour of the first write relay; kept as `mode` for the original tests. */
  mode: 'holds' as 'holds' | 'empty' | 'silent',
  /** Extra write relays and how each behaves. */
  extra: {} as Record<string, { behaviour: Behaviour; profile?: unknown; delayMs?: number }>,
  /** A kind:0 Space's own pool returns, if any. */
  poolProfile: null as unknown,
  relayList: true,
  published: [] as { kind: number; content: string }[],
  asked: [] as string[][],
}));

const relayListEvent = () =>
  finalizeEvent(
    { kind: 10002, created_at: 10, content: '', tags: [['r', W, 'write'], ...Object.keys(env.extra).map((u) => ['r', u, 'write'])] },
    meSk,
  );
const profileAt = (created_at: number, fields: Record<string, string>) =>
  finalizeEvent({ kind: 0, created_at, content: JSON.stringify(fields), tags: [] }, meSk);
const ownProfile = profileAt(20, { name: 'me', website: 'https://me.example' });

vi.mock('@/services/nostr', () => {
  // One stable object, as the real provider's memoised value is.
  const ndk = {
    isConnected: true,
    // Space's own pool: no kind:0 there unless a test puts one.
    fetchEvents: async (filter: { kinds: number[] }) =>
      new Set(
        filter.kinds.includes(10002)
          ? env.relayList ? [relayListEvent()] : []
          : env.poolProfile ? [env.poolProfile] : [],
      ),
    // One relay per subscription, as the hook asks each write relay separately.
    subscribe: (
      filters: { kinds: number[] }[],
      opts: { relaySet?: { urls: string[] } },
      handlers: { onEvent?: (e: unknown) => void; onEose?: () => void }
    ) => {
      const urls = opts.relaySet?.urls ?? [];
      env.asked.push(urls);
      const sub = { eosesSeen: new Set<unknown>(), stop: vi.fn() };
      const url = urls[0];
      const cfg =
        url === W
          ? { behaviour: env.mode as Behaviour, profile: ownProfile, delayMs: 0 }
          : env.extra[url] ??
            // The public relay-list indexers, asked when the pool has no
            // kind:10002: they answer with nothing.
            (filters[0]?.kinds.includes(10002) ? { behaviour: 'empty' as Behaviour } : undefined);
      if (cfg && cfg.behaviour === 'eoseWithoutRelay') {
        // NDK's own timer ends the subscription; the relay itself never sent EOSE.
        setTimeout(() => handlers.onEose?.(), cfg.delayMs ?? 0);
      } else if (cfg && cfg.behaviour !== 'silent') {
        setTimeout(() => {
          if (cfg.behaviour === 'holds') handlers.onEvent?.(cfg.profile ?? ownProfile);
          sub.eosesSeen.add({ url });
          handlers.onEose?.();
        }, cfg.delayMs ?? 0);
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
const { PUBLIC_OUTBOX_INDEXERS } = await import('@/services/nostr/ndk');

beforeEach(() => {
  env.mode = 'holds';
  env.extra = {};
  env.poolProfile = null;
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
    // Only the relay-list indexers were asked; there are no write relays to ask.
    expect(env.asked).toEqual(PUBLIC_OUTBOX_INDEXERS.map((u) => [u]));
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

describe('several write relays (review of !228, and the ruling on found)', () => {
  it('one empty answer while another relay is silent is not "absent", and the save names the silent relay', async () => {
    vi.useFakeTimers();
    try {
      env.mode = 'empty';
      env.extra = { [W2]: { behaviour: 'silent' } };
      const hook = renderHook(() => useProfile());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OWN_RELAY_PROFILE_TIMEOUT_MS + 10);
      });
      expect(hook.result.current.existing?.status).toBe('unreadable');
      expect(hook.result.current.error).toContain('second.example');

      await act(async () => {
        await hook.result.current.saveProfile({ about: 'hello' }).catch(() => undefined);
      });
      expect(env.published).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  // A save re-signs the fields it read, so a forged profile from a write
  // relay would be published as the user's own. A forgery is no answer.
  it('a write relay serving a forged profile counts as not answering, and the save is refused', async () => {
    env.mode = 'empty';
    env.extra = { [W2]: { behaviour: 'holds', profile: { ...profileAt(50, { name: 'me' }), content: JSON.stringify({ name: 'forged', lud16: 'thief@example.com' }) } } };
    const { result } = await loaded();
    expect(result.current.existing?.status).toBe('unreadable');
    expect(result.current.profile.name).toBeUndefined();

    await act(async () => {
      await result.current.saveProfile({ about: 'hello' }).catch(() => undefined);
    });
    expect(env.published).toEqual([]);
  });

  it('a slower relay holding a newer profile wins over the first to answer', async () => {
    env.extra = { [W2]: { behaviour: 'holds', profile: profileAt(50, { name: 'newer' }), delayMs: 30 } };
    const { result } = await loaded();
    expect(result.current.existing?.status).toBe('found');
    expect(result.current.profile.name).toBe('newer');
  });

  it("a newer profile on the user's own relay wins over an older one in Space's pool", async () => {
    env.poolProfile = profileAt(5, { name: 'stale' });
    const { result } = await loaded();
    expect(result.current.profile.name).toBe('me');
  });

  it('when one relay never answers but another found a profile, the newest seen is used', async () => {
    vi.useFakeTimers();
    try {
      env.extra = { [W2]: { behaviour: 'silent' } };
      const hook = renderHook(() => useProfile());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OWN_RELAY_PROFILE_TIMEOUT_MS + 10);
      });
      expect(hook.result.current.existing?.status).toBe('found');
      expect(hook.result.current.profile.name).toBe('me');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is absent only when every write relay answered with nothing', async () => {
    env.mode = 'empty';
    env.extra = { [W2]: { behaviour: 'empty', delayMs: 20 } };
    const { result } = await loaded();
    expect(result.current.existing?.status).toBe('absent');
  });

  it('an EOSE that NDK fires without the relay having answered is silence, not "absent"', async () => {
    env.mode = 'empty';
    env.extra = { [W2]: { behaviour: 'eoseWithoutRelay' } };
    const { result } = await loaded();
    expect(result.current.existing?.status).toBe('unreadable');
    await act(async () => {
      await result.current.saveProfile({ about: 'hello' }).catch(() => undefined);
    });
    expect(env.published).toEqual([]);
  });
});
