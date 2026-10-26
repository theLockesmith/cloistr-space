/**
 * @fileoverview The Threads list reads private threads: a fleet thread whose
 * key the user holds, by thread id, whoever signed each message.
 *
 * Fixtures are the kit's own output (see kitThreads.test.ts): a kind:1111
 * signed by a ROLE key, and a wrap-mode kind 1059 under a one-time key.
 */

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { hexToBytes } from 'nostr-tools/utils';
import { ThreadKeyStore, encryptThreadContent } from './threadKeyStore';
import { tryUnwrapMessage, tryUnwrapHandoff, type UnwrappedMessage, type UnwrappedHandoff } from './giftWrap';
import kit from './__fixtures__/kitThreadEvents.json';

const threadSk = hexToBytes('11'.repeat(32));
const threadPk = kit.keys.threadPk;
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

// The one bucket reader the Threads page shares with its Sealed box. What it
// returns is what the real reader would: only wraps that opened with a held
// key, and the sealed hand-offs addressed to this user.
const reader: { messages: UnwrappedMessage[]; handoffs: UnwrappedHandoff[] } = { messages: [], handoffs: [] };
const ROLE = getPublicKey(generateSecretKey());
const readerCalls: unknown[][] = [];
vi.mock('./useBucketReader', () => ({
  useBucketReader: (...args: unknown[]) => {
    readerCalls.push(args);
    return { ...reader, isLoading: false, error: null, refresh: vi.fn(), debug: {} };
  },
}));
const handoff = tryUnwrapHandoff(kit.handoff, hexToBytes('33'.repeat(32)), [kit.keys.granterPk])!;
reader.handoffs = [handoff];
vi.mock('./useThreadKeyStore', () => ({ useThreadKeyStore: () => keyStore }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (sel?: (s: { pubkey: string }) => unknown) => (sel ? sel({ pubkey: currentMe }) : { pubkey: currentMe }) }));
vi.mock('@/config/environment', () => ({ config: { threadGranters: [FLEET, kit.keys.granterPk] } }));

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
    pubkey: ROLE,
    created_at: 1_790_000_100,
    content: encryptThreadContent(env, tsk, ROLE),
    tags: [['d', 'cloistr-group-wrap'], ['K', '1111'], ['thread', tpk]],
  };
}

describe('useAllThreads standalone threads', () => {
  it('asks for fleet threads by thread id, never by the fleet’s key', () => {
    subs.length = 0;
    renderHook(() => useAllThreads());
    const filters = subs.flatMap((s) => s.filters);
    const byAuthor = filters.filter((f) => Array.isArray(f.authors)).flatMap((f) => f.authors as string[]);
    expect(byAuthor).not.toContain(FLEET);
    expect(filters).toContainEqual({ kinds: [1111], '#d': ['cloistr-group-wrap'] });
  });

  it('a role-key kind:1111 and a wrap-mode kind 1059 of a held thread both appear, as one conversation', async () => {
    subs.length = 0;
    reader.messages = [tryUnwrapMessage(kit.wrap, keyStore)!];
    const { result } = renderHook(() => useAllThreads());
    relay(kit.legacy1111);

    await waitFor(() => expect(result.current.privateThreads).toHaveLength(1));
    const t = result.current.privateThreads[0];
    expect(t.title).toBe('cloistr-group-wrap');
    expect(t.messages.map((m) => m.text).sort()).toEqual(['legacy hello', 'wrap-mode hello']);
    reader.messages = [];
  });

  it('a wrap for a key the user does NOT hold never reaches the list', () => {
    subs.length = 0;
    // The reader keeps only wraps that opened: this one does not.
    expect(tryUnwrapMessage(kit.wrapUnheld, keyStore)).toBeNull();
  });

  it('shares one bucket reader, asking it for the fleet granters’ hand-offs', () => {
    readerCalls.length = 0;
    renderHook(() => useAllThreads());
    expect(readerCalls.length).toBeGreaterThan(0);
    const [secret, granters] = readerCalls[readerCalls.length - 1] as [unknown, string[]];
    expect(secret).toBeNull();
    expect(granters).toEqual(expect.arrayContaining([FLEET, kit.keys.granterPk]));
  });

  it('shows a fleet-style sealed thread whose key is held as private, and the user’s own root as public', async () => {
    subs.length = 0;
    const { result } = renderHook(() => useAllThreads());
    relay(fleetMessage('deploy is broken', threadSk, threadPk, 'a'));
    relay({ id: 'b'.padEnd(64, '0'), kind: 1111, pubkey: ME, created_at: 1_790_000_200, content: 'my own thread', tags: [['subject', 'Mine']] });

    await waitFor(() => expect(result.current.privateThreads).toHaveLength(1));
    await waitFor(() => expect(result.current.publicThreads).toHaveLength(1));
    expect(result.current.privateThreads[0].title).toBe('cloistr-group-wrap');
    expect(result.current.privateThreads[0].messages[0].text).toBe('deploy is broken');
    expect(result.current.publicThreads[0].thread.root.subject).toBe('Mine');
  });

  it('a thread for a key the user does NOT hold stays invisible and uncounted', async () => {
    subs.length = 0;
    const { result } = renderHook(() => useAllThreads());
    relay(fleetMessage('not yours', unheldSk, unheldPk, 'c'));
    relay(fleetMessage('yours', threadSk, threadPk, 'd'));

    await waitFor(() => expect(result.current.privateThreads).toHaveLength(1));
    expect(JSON.stringify(result.current)).not.toContain(unheldPk);
    expect(result.current.privateThreads[0].messages.map((m) => m.text)).toEqual(['yours']);
  });

  it('switching keys drops the previous key’s threads before the new key’s arrive', async () => {
    subs.length = 0;
    currentMe = ME;
    const { result, rerender } = renderHook(() => useAllThreads());
    relay({ id: 'e'.padEnd(64, '0'), kind: 11, pubkey: ME, created_at: 1_790_000_300, content: 'A’s own thread', tags: [['title', 'A']] });
    relay(fleetMessage('for A', threadSk, threadPk, 'f'));
    await waitFor(() => expect(result.current.publicThreads).toHaveLength(1));
    await waitFor(() => expect(result.current.privateThreads).toHaveLength(1));

    currentMe = OTHER_ME;
    rerender();
    expect(result.current.publicThreads).toEqual([]);
    expect(result.current.privateThreads).toEqual([]);
    currentMe = ME;
  });

  it('a thread whose hand-off has expired from the relays is still asked for by its saved name', () => {
    subs.length = 0;
    const savedHandoffs = reader.handoffs;
    reader.handoffs = [];
    keyStore.setName(threadPk, 'cloistr-group-wrap');
    try {
      renderHook(() => useAllThreads());
      const filters = subs.flatMap((s) => s.filters);
      expect(filters).toContainEqual({ kinds: [1111], '#d': ['cloistr-group-wrap'] });
    } finally {
      reader.handoffs = savedHandoffs;
      keyStore.clear();
      keyStore.set(threadPk, threadSk);
    }
  });

  it('a saved name is not asked for once its key is gone', () => {
    subs.length = 0;
    const savedHandoffs = reader.handoffs;
    reader.handoffs = [];
    keyStore.setName(unheldPk, 'not-mine');
    try {
      renderHook(() => useAllThreads());
      const asked = subs.flatMap((s) => s.filters).flatMap((f) => (f['#d'] as string[] | undefined) ?? []);
      expect(asked).not.toContain('not-mine');
    } finally {
      reader.handoffs = savedHandoffs;
      keyStore.clear();
      keyStore.set(threadPk, threadSk);
    }
  });
});
