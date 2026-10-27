/**
 * @fileoverview useAllThreads, public side: what it asks the relays, and what
 * reaches the one list (threads.md 6).
 *
 * The questions matter as much as the answers: kind 11 roots are invisible to
 * a filter that asks only for 1111, replies to a thread outside the user's
 * groups are invisible to the group filter, and an archive is invisible unless
 * labels are asked for at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { STATUS_LABEL_KIND, STATUS_NAMESPACE } from '@cloistr/threads';
import { ThreadKeyStore, encryptThreadContent } from './threadKeyStore';

const ME = getPublicKey(generateSecretKey());
const OTHER = getPublicKey(generateSecretKey());
const ROLE = getPublicKey(generateSecretKey());
const threadSk = generateSecretKey();
const threadPk = getPublicKey(threadSk);

type Sub = { filters: Record<string, unknown>[]; onEvent: (e: unknown) => void; onEose?: () => void; stopped: boolean };
const subs: Sub[] = [];

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({ subscribe: vi.fn(), isConnected: true }),
  subscribeStream: vi.fn((_subscribe, filters, handlers) => {
    const sub: Sub = { filters, ...handlers, stopped: false };
    subs.push(sub);
    return { stop: () => (sub.stopped = true) };
  }),
}));
vi.mock('@/services/groups', () => ({
  useGroups: () => ({
    groups: [{ group: { identifier: 'devs', name: 'Developers' }, role: 'member', adminPubkeys: [] }],
    isLoading: false,
  }),
}));
vi.mock('./useBucketReader', () => ({
  useBucketReader: () => ({ messages: [], handoffs: [], pendingHandoffs: [], isLoading: false, error: null, refresh: vi.fn(), debug: {} }),
}));
const keyStore = new ThreadKeyStore();
keyStore.set(threadPk, threadSk);
vi.mock('./useThreadKeyStore', () => ({ useThreadKeyStore: () => keyStore }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (sel?: (s: { pubkey: string }) => unknown) => (sel ? sel({ pubkey: ME }) : { pubkey: ME }),
}));
vi.mock('@/config/environment', () => ({ config: { threadGranters: [] } }));

const { useAllThreads } = await import('./useAllThreads');

/** Deliver an event the way one relay connection does: to every open subscription. */
function relay(event: unknown) {
  act(() => {
    for (const s of subs) if (!s.stopped) s.onEvent(event);
  });
}

const openFilters = () => subs.filter((s) => !s.stopped).flatMap((s) => s.filters);

let n = 0;
function ev(over: { kind: number; pubkey?: string; tags: string[][]; content?: string; created_at?: number; id?: string }) {
  n += 1;
  return { id: over.id ?? `e${n}`.padEnd(64, '0'), pubkey: ME, content: '', created_at: 1_790_000_000 + n, ...over };
}

beforeEach(() => {
  subs.length = 0;
});

describe('useAllThreads: public threads', () => {
  it('asks for kind 11 roots as well as 1111, in the user’s groups and by the user anywhere', () => {
    renderHook(() => useAllThreads());
    expect(openFilters()).toContainEqual({ kinds: [11, 1111], '#h': ['devs'] });
    expect(openFilters()).toContainEqual({ kinds: [11, 1111], authors: [ME] });
  });

  it('a kind 11 root in the user’s group appears, scoped to the group', async () => {
    const { result } = renderHook(() => useAllThreads());
    relay(ev({ kind: 11, pubkey: OTHER, tags: [['h', 'devs'], ['title', 'Release plan']] }));
    await waitFor(() => expect(result.current.publicThreads).toHaveLength(1));
    expect(result.current.publicThreads[0]).toMatchObject({ groupId: 'devs', rootKind: 11 });
    expect(result.current.publicThreads[0].thread.root.subject).toBe('Release plan');
  });

  it('asks for replies to the user’s thread outside any group, and shows them', async () => {
    const { result } = renderHook(() => useAllThreads());
    const root = ev({ kind: 11, tags: [['title', 'Mine']] });
    relay(root);
    await waitFor(() => expect(openFilters()).toContainEqual({ kinds: [1111], '#E': [root.id] }));

    relay(ev({ kind: 1111, pubkey: OTHER, content: 'a reply', tags: [['E', root.id, '', ME], ['K', '11'], ['e', root.id, '', ME], ['k', '11']] }));
    await waitFor(() => expect(result.current.publicThreads[0]?.thread.replyCount).toBe(1));
    expect(result.current.publicThreads[0].groupId).toBeNull();
  });

  it('asks root authors, and only them, for status labels, and applies an archive', async () => {
    const { result } = renderHook(() => useAllThreads());
    const root = ev({ kind: 11, pubkey: OTHER, tags: [['h', 'devs'], ['title', 't']] });
    relay(root);
    await waitFor(() =>
      expect(openFilters()).toContainEqual({ kinds: [STATUS_LABEL_KIND], '#L': [STATUS_NAMESPACE], '#e': [root.id], authors: [OTHER] }),
    );

    relay(ev({ kind: STATUS_LABEL_KIND, pubkey: OTHER, tags: [['L', STATUS_NAMESPACE], ['l', 'archived', STATUS_NAMESPACE], ['e', root.id]] }));
    await waitFor(() => expect(result.current.publicThreads[0].thread.status).toBe('archived'));
  });

  it('the kit’s sealed message in the user’s group is a private thread, not a public post of ciphertext', async () => {
    const { result } = renderHook(() => useAllThreads());
    const env = JSON.stringify({ v: 'arbiter-fleet-msg-v1', body: 'deploy is broken', task: null, role: 'x', from: 'y', thread: 'ops' });
    relay(ev({ kind: 1111, pubkey: ROLE, content: encryptThreadContent(env, threadSk, ROLE), tags: [['d', 'ops'], ['K', '1111'], ['thread', threadPk], ['h', 'devs']] }));

    await waitFor(() => expect(result.current.privateThreads).toHaveLength(1));
    expect(result.current.privateThreads[0]).toMatchObject({ title: 'ops', projectId: 'devs', sealed: true });
    expect(result.current.publicThreads).toEqual([]);
  });

  it('is loading until the relays have answered, then not', async () => {
    const { result } = renderHook(() => useAllThreads());
    expect(result.current.isLoading).toBe(true);
    act(() => subs[subs.length - 1].onEose?.());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});
