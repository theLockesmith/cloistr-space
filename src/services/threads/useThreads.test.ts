/**
 * @fileoverview Tests for useThreads NIP-44 sealed thread integration.
 *
 * Covers the three code paths this feature added:
 * - Decrypt on read: sealed content decrypts when the key is held, and the
 *   parsed comment carries sealed: true
 * - Encrypt on write: createThread encrypts content when a thread key is held
 * - Plaintext fallback: content passes through unmodified when no key is held
 *
 * useThreads defers its subscription to a macrotask via setTimeout(fn, 0), so
 * tests use fake timers and advance them to trigger the subscription setup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  ThreadKeyStore,
  encryptThreadContent,
  looksLikeNip44,
} from './threadKeyStore';
import { THREAD_KIND } from './threadEvents';

// ---- Test keys ----

const threadSk = generateSecretKey();
const threadPk = getPublicKey(threadSk);
const authorPk = getPublicKey(generateSecretKey());
const userPk = getPublicKey(generateSecretKey());

// ---- Mocks ----

let capturedOnEvent: ((event: unknown) => void) | null = null;
let capturedOnEose: (() => void) | null = null;

const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockCreateEvent = vi.fn(() => ({
  kind: 0,
  content: '',
  tags: [] as string[][],
}));

const GROUP_ID = 'devs';

function makeMocks(keyStore: ThreadKeyStore) {
  vi.doMock('@/services/nostr', () => ({
    useNdk: () => ({
      subscribe: vi.fn(),
      isConnected: true,
      publish: mockPublish,
      createEvent: mockCreateEvent,
      service: null,
      isConnecting: false,
      relayStatuses: new Map(),
      reconnect: vi.fn(),
      fetchEvents: vi.fn(),
      fetchFromOwnRelays: null,
    }),
    subscribeStream: vi.fn((_subscribe: unknown, _filters: unknown, handlers: { onEvent: (e: unknown) => void; onEose: () => void }) => {
      capturedOnEvent = handlers.onEvent;
      capturedOnEose = handlers.onEose;
      return { stop: vi.fn() };
    }),
  }));
  vi.doMock('@/stores/authStore', () => ({
    useAuthStore: () => ({ pubkey: userPk }),
  }));
  vi.doMock('./useThreadKeyStore', () => ({
    useThreadKeyStore: () => keyStore,
  }));
}

// ---- Key store variations ----

const storeWithKey = new ThreadKeyStore();
storeWithKey.set(threadPk, threadSk);

const emptyStore = new ThreadKeyStore();

// ---- Helpers ----

function makeEvent(opts: {
  id: string;
  content: string;
  pubkey: string;
  threadTag?: string;
}) {
  return {
    id: opts.id,
    pubkey: opts.pubkey,
    content: opts.content,
    created_at: Math.floor(Date.now() / 1000),
    kind: THREAD_KIND,
    tags: [
      ['h', GROUP_ID],
      ['subject', 'Test'],
      ...(opts.threadTag ? [['thread', opts.threadTag]] : []),
    ],
  };
}

// ---- Tests ----

describe('useThreads sealed thread decryption', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    capturedOnEvent = null;
    capturedOnEose = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('decrypts sealed content and marks the comment as sealed', async () => {
    makeMocks(storeWithKey);
    const { useThreads } = await import('./useThreads');

    const plaintext = 'Staging is on fire.';
    const ciphertext = encryptThreadContent(plaintext, threadSk, authorPk);

    const { result } = renderHook(() => useThreads(GROUP_ID, threadPk));

    // Advance past the setTimeout(fn, 0) that defers subscription setup
    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(capturedOnEvent).not.toBeNull();

    await act(async () => {
      capturedOnEvent!(makeEvent({
        id: 'sealed-1',
        content: ciphertext,
        pubkey: authorPk,
        threadTag: threadPk,
      }));
      capturedOnEose!();
    });

    expect(result.current.threads).toHaveLength(1);
    const root = result.current.threads[0].root;
    expect(root.content).toBe(plaintext);
    expect(root.sealed).toBe(true);
  });

  it('passes plaintext through without the sealed flag', async () => {
    makeMocks(storeWithKey);
    const { useThreads } = await import('./useThreads');

    const { result } = renderHook(() => useThreads(GROUP_ID, threadPk));

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    await act(async () => {
      capturedOnEvent!(makeEvent({
        id: 'plain-1',
        content: 'Just a normal message',
        pubkey: authorPk,
      }));
      capturedOnEose!();
    });

    expect(result.current.threads).toHaveLength(1);
    const root = result.current.threads[0].root;
    expect(root.content).toBe('Just a normal message');
    expect(root.sealed).toBeUndefined();
  });

  it('leaves ciphertext intact and marks sealed when key is not held', async () => {
    makeMocks(emptyStore);
    const { useThreads } = await import('./useThreads');

    const ciphertext = encryptThreadContent('secret', threadSk, authorPk);

    const { result } = renderHook(() => useThreads(GROUP_ID, threadPk));

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    await act(async () => {
      capturedOnEvent!(makeEvent({
        id: 'no-key-1',
        content: ciphertext,
        pubkey: authorPk,
        threadTag: threadPk,
      }));
      capturedOnEose!();
    });

    expect(result.current.threads).toHaveLength(1);
    const root = result.current.threads[0].root;
    expect(root.content).toBe(ciphertext);
    expect(looksLikeNip44(root.content)).toBe(true);
    expect(root.sealed).toBe(true);
  });
});

describe('useThreads sealed thread encryption', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    capturedOnEvent = null;
    capturedOnEose = null;
    vi.clearAllMocks();
    mockPublish.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('createThread encrypts body when thread key is held', async () => {
    makeMocks(storeWithKey);
    const { useThreads } = await import('./useThreads');

    const { result } = renderHook(() => useThreads(GROUP_ID, threadPk));

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    // Signal subscription settled
    await act(async () => {
      capturedOnEose?.();
    });

    await act(async () => {
      await result.current.createThread('Test subject', 'Secret body');
    });

    expect(mockPublish).toHaveBeenCalledOnce();
    const event = mockPublish.mock.calls[0][0];
    expect(event.kind).toBe(THREAD_KIND);
    expect(event.content).not.toBe('Secret body');
    expect(looksLikeNip44(event.content)).toBe(true);

    // The event must carry a thread tag so cross-group readers can identify
    // which key to use for decryption.
    const threadTag = event.tags.find((t: string[]) => t[0] === 'thread');
    expect(threadTag).toBeDefined();
    expect(threadTag![1]).toBe(threadPk);
  });

  it('createThread sends plaintext when no threadPubkey', async () => {
    makeMocks(emptyStore);
    const { useThreads } = await import('./useThreads');

    // No threadPubkey passed
    const { result } = renderHook(() => useThreads(GROUP_ID));

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    await act(async () => {
      capturedOnEose?.();
    });

    await act(async () => {
      await result.current.createThread('Open thread', 'Public body');
    });

    expect(mockPublish).toHaveBeenCalledOnce();
    const event = mockPublish.mock.calls[0][0];
    expect(event.content).toBe('Public body');

    // No thread tag when composing without a sealed thread
    expect(event.tags.find((t: string[]) => t[0] === 'thread')).toBeUndefined();
  });
});
