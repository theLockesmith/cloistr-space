/**
 * @fileoverview Tests for useAllThreads, focused on the NIP-44 decryption path.
 *
 * The cross-group thread listing must decrypt sealed content the same way the
 * per-group view does. These tests pin that behavior: a message whose thread
 * key is held decrypts, one without a key (or without a thread tag) passes
 * through as raw ciphertext.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey, nip44, utils as ntUtils } from 'nostr-tools';
import { ThreadKeyStore, encryptThreadContent } from './threadKeyStore';
import { THREAD_KIND } from './threadEvents';

const { bytesToHex } = ntUtils;

// ---- Test keys ----

const threadSk = generateSecretKey();
const threadPk = getPublicKey(threadSk);
const authorSk = generateSecretKey();
const authorPk = getPublicKey(authorSk);

// ---- Mocks ----

// subscribeStream: we capture the onEvent handler so we can feed it events.
let capturedOnEvent: ((event: unknown) => void) | null = null;
let capturedOnEose: (() => void) | null = null;

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({
    subscribe: vi.fn(),
    isConnected: true,
    fetchEvents: vi.fn(),
    service: null,
    isConnecting: false,
    relayStatuses: new Map(),
    reconnect: vi.fn(),
    publish: null,
    createEvent: vi.fn(),
    fetchFromOwnRelays: null,
  }),
  subscribeStream: vi.fn((_subscribe, _filters, handlers) => {
    capturedOnEvent = handlers.onEvent;
    capturedOnEose = handlers.onEose;
    return { stop: vi.fn() };
  }),
}));

vi.mock('@/services/groups', () => ({
  useGroups: () => ({
    groups: [
      {
        group: { identifier: 'devs', name: 'Developers' },
        role: 'member',
        pubkey: '1'.repeat(64),
      },
    ],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

// Build a real ThreadKeyStore with the test thread key loaded.
const testKeyStore = new ThreadKeyStore();
testKeyStore.set(threadPk, threadSk);

vi.mock('./useThreadKeyStore', () => ({
  useThreadKeyStore: () => testKeyStore,
}));

// ---- Helpers ----

function makeThreadEvent(opts: {
  id: string;
  content: string;
  groupId: string;
  pubkey: string;
  threadTag?: string;
  isRoot?: boolean;
  rootId?: string;
  parentId?: string;
}) {
  const tags: string[][] = [['h', opts.groupId]];
  if (opts.threadTag) tags.push(['thread', opts.threadTag]);
  if (opts.isRoot) tags.push(['subject', 'Test thread']);
  if (opts.rootId) {
    tags.push(['E', opts.rootId, '', opts.pubkey]);
    tags.push(['e', opts.parentId ?? opts.rootId, '', opts.pubkey]);
  }

  return {
    id: opts.id,
    pubkey: opts.pubkey,
    content: opts.content,
    created_at: Math.floor(Date.now() / 1000),
    kind: THREAD_KIND,
    tags,
  };
}

// ---- Tests ----

describe('useAllThreads NIP-44 decryption', () => {
  beforeEach(() => {
    capturedOnEvent = null;
    capturedOnEose = null;
  });

  it('decrypts sealed content when the thread key is held', async () => {
    // Lazy import so mocks are in place
    const { useAllThreads } = await import('./useAllThreads');

    const plaintext = 'The staging deploy is broken.';
    const ciphertext = encryptThreadContent(plaintext, threadSk, authorPk);

    const { result } = renderHook(() => useAllThreads());

    // Feed the subscription handler a sealed event
    expect(capturedOnEvent).not.toBeNull();
    capturedOnEvent!(makeThreadEvent({
      id: 'sealed-root',
      content: ciphertext,
      groupId: 'devs',
      pubkey: authorPk,
      threadTag: threadPk,
      isRoot: true,
    }));
    capturedOnEose!();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0].thread.root.content).toBe(plaintext);
  });

  it('passes ciphertext through when no thread tag is present', async () => {
    // Reset module registry so the lazy import picks up fresh state
    vi.resetModules();
    // Re-apply mocks after reset
    vi.doMock('@/services/nostr', () => ({
      useNdk: () => ({
        subscribe: vi.fn(),
        isConnected: true,
        fetchEvents: vi.fn(),
        service: null,
        isConnecting: false,
        relayStatuses: new Map(),
        reconnect: vi.fn(),
        publish: null,
        createEvent: vi.fn(),
        fetchFromOwnRelays: null,
      }),
      subscribeStream: vi.fn((_subscribe, _filters, handlers) => {
        capturedOnEvent = handlers.onEvent;
        capturedOnEose = handlers.onEose;
        return { stop: vi.fn() };
      }),
    }));
    vi.doMock('@/services/groups', () => ({
      useGroups: () => ({
        groups: [
          {
            group: { identifier: 'devs', name: 'Developers' },
            role: 'member',
            pubkey: '1'.repeat(64),
          },
        ],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
      }),
    }));
    vi.doMock('./useThreadKeyStore', () => ({
      useThreadKeyStore: () => testKeyStore,
    }));

    const { useAllThreads } = await import('./useAllThreads');

    const ciphertext = encryptThreadContent('secret message', threadSk, authorPk);

    const { result } = renderHook(() => useAllThreads());

    // Feed an event with NO thread tag, so the key lookup has no pubkey to use
    expect(capturedOnEvent).not.toBeNull();
    capturedOnEvent!(makeThreadEvent({
      id: 'no-thread-tag',
      content: ciphertext,
      groupId: 'devs',
      pubkey: authorPk,
      // no threadTag
      isRoot: true,
    }));
    capturedOnEose!();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.threads).toHaveLength(1);
    // Content should be the raw ciphertext since there's no thread tag
    expect(result.current.threads[0].thread.root.content).toBe(ciphertext);
  });
});
