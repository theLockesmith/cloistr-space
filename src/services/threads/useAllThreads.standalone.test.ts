/**
 * @fileoverview The Threads list reads standalone threads too: a fleet-style
 * sealed kind:1111 for a key the user holds, and the user's own thread with no
 * project. On master neither appears (useAllThreads only asks for #h of the
 * user's projects and drops anything without an h).
 */

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { ThreadKeyStore, encryptThreadContent } from './threadKeyStore';

const threadSk = generateSecretKey();
const threadPk = getPublicKey(threadSk);
const unheldSk = generateSecretKey();
const unheldPk = getPublicKey(unheldSk);
const fleetSk = generateSecretKey();
const FLEET = getPublicKey(fleetSk);
const ME = getPublicKey(generateSecretKey());
const OTHER_ME = getPublicKey(generateSecretKey());
let currentMe = ME;

const subs: { filters: Record<string, unknown>[]; onEvent: (e: unknown) => void; onEose?: () => void }[] = [];

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({ subscribe: vi.fn(), isConnected: true }),
  subscribeStream: vi.fn((_subscribe, filters, handlers) => {
    subs.push({ filters, ...handlers });
    return { stop: vi.fn() };
  }),
}));
vi.mock('@/services/groups', () => ({
  useGroups: () => ({
    groups: [{ group: { identifier: 'devs', name: 'Developers' }, role: 'member', adminPubkeys: [] }],
    isLoading: false,
  }),
}));
const keyStore = new ThreadKeyStore();
keyStore.set(threadPk, threadSk);
vi.mock('./useThreadKeyStore', () => ({ useThreadKeyStore: () => keyStore }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (sel?: (s: { pubkey: string }) => unknown) => (sel ? sel({ pubkey: currentMe }) : { pubkey: currentMe }) }));
vi.mock('@/config/environment', () => ({ config: { threadGranters: [FLEET] } }));

const { useAllThreads } = await import('./useAllThreads');

/** Deliver an event the way one relay connection does: to every open subscription. */
function relay(event: unknown) {
  act(() => {
    for (const s of subs) s.onEvent(event);
  });
}

function fleetMessage(body: string, tsk: Uint8Array, tpk: string, id: string) {
  const env = JSON.stringify({ v: 'arbiter-fleet-msg-v1', body, task: null, role: 'cloistr-space', from: 'cloistr-orchestrator', thread: 'cloistr-group-wrap' });
  return {
    id: id.padEnd(64, '0'),
    kind: 1111,
    pubkey: FLEET,
    created_at: 1_790_000_100,
    content: encryptThreadContent(env, tsk, FLEET),
    tags: [['d', 'cloistr-group-wrap'], ['K', '1111'], ['thread', tpk]],
  };
}

describe('useAllThreads standalone threads', () => {
  it('asks the relay for the fleet’s and the user’s own thread messages', () => {
    subs.length = 0;
    renderHook(() => useAllThreads());
    const authors = subs.flatMap((s) => s.filters).find((f) => Array.isArray(f.authors))?.authors as string[] | undefined;
    expect(authors?.sort()).toEqual([FLEET, ME].sort());
  });

  it('shows a fleet-style sealed thread whose key is held, and the user’s own root with no project', async () => {
    subs.length = 0;
    const { result } = renderHook(() => useAllThreads());
    relay(fleetMessage('deploy is broken', threadSk, threadPk, 'a'));
    relay({ id: 'b'.padEnd(64, '0'), kind: 1111, pubkey: ME, created_at: 1_790_000_200, content: 'my own thread', tags: [['subject', 'Mine']] });

    await waitFor(() => expect(result.current.standalone).toHaveLength(2));
    const titles = result.current.standalone.map((t) => t.title).sort();
    expect(titles).toEqual(['Mine', 'cloistr-group-wrap']);
    const fleet = result.current.standalone.find((t) => t.title === 'cloistr-group-wrap')!;
    expect(fleet.messages[0].text).toBe('deploy is broken');
  });

  it('a thread for a key the user does NOT hold stays invisible and uncounted', async () => {
    subs.length = 0;
    const { result } = renderHook(() => useAllThreads());
    relay(fleetMessage('not yours', unheldSk, unheldPk, 'c'));
    relay(fleetMessage('yours', threadSk, threadPk, 'd'));

    await waitFor(() => expect(result.current.standalone).toHaveLength(1));
    expect(JSON.stringify(result.current)).not.toContain(unheldPk);
    expect(result.current.standalone[0].messages.map((m) => m.text)).toEqual(['yours']);
  });

  it('switching keys drops the previous key’s threads before the new key’s arrive', async () => {
    subs.length = 0;
    currentMe = ME;
    const { result, rerender } = renderHook(() => useAllThreads());
    relay({ id: 'e'.padEnd(64, '0'), kind: 1111, pubkey: ME, created_at: 1_790_000_300, content: 'A’s own thread', tags: [] });
    await waitFor(() => expect(result.current.standalone).toHaveLength(1));

    currentMe = OTHER_ME;
    rerender();
    expect(result.current.standalone).toEqual([]);
    currentMe = ME;
  });
});
