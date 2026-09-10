/**
 * @fileoverview Tests for useThreadKeyStore and useThreadKeyLoader.
 *
 * These are React hook tests, so they run inside renderHook. The hooks depend
 * on useNdk, useAuth, and useAuthStore, all mocked at the module level. The
 * singleton store is reset between tests via _resetGlobalStore.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey, nip44, utils as ntUtils } from 'nostr-tools';
import {
  useThreadKeyStore,
  useThreadKeyLoader,
  _resetGlobalStore,
} from './useThreadKeyStore';
import { KEY_WRAP_KIND } from './threadKeyStore';

const { bytesToHex } = ntUtils;

// A real recipient keypair so NIP-44 conversation key derivation works.
const RECIPIENT_SK = generateSecretKey();
const RECIPIENT_PK = getPublicKey(RECIPIENT_SK);

// ---- Mocks ----

const mockFetchEvents = vi.fn();
const mockSigner = {
  nip44Decrypt: vi.fn(),
  getPublicKey: vi.fn(),
  signEvent: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
};

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({
    fetchEvents: mockFetchEvents,
    isConnected: true,
    service: null,
    isConnecting: false,
    relayStatuses: new Map(),
    reconnect: vi.fn(),
    subscribe: null,
    fetchFromOwnRelays: null,
    createEvent: vi.fn(),
    publish: null,
  }),
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    signer: mockSigner,
    pubkey: RECIPIENT_PK,
    isAuthenticated: true,
    isLoading: false,
    error: null,
    nip07Available: false,
    loginNip07: vi.fn(),
    loginNip46: vi.fn(),
    logout: vi.fn(),
    signEvent: vi.fn(),
  }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    pubkey: RECIPIENT_PK,
  }),
}));

// ---- Helpers ----

function makeKeyWrapEvent(
  threadSk: Uint8Array,
  granterSk: Uint8Array,
  recipientPk: string,
) {
  const threadPk = getPublicKey(threadSk);
  const granterPk = getPublicKey(granterSk);

  // The content is the thread secret key hex, NIP-44 encrypted to the recipient
  const conversationKey = nip44.v2.utils.getConversationKey(granterSk, recipientPk);
  const encryptedContent = nip44.v2.encrypt(bytesToHex(threadSk), conversationKey);

  return {
    id: 'wrap-' + threadPk.slice(0, 8),
    pubkey: granterPk,
    kind: KEY_WRAP_KIND,
    content: encryptedContent,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', threadPk],
      ['p', recipientPk],
    ],
  };
}

// ---- Tests ----

describe('useThreadKeyStore', () => {
  beforeEach(() => {
    _resetGlobalStore();
  });

  it('returns the same store instance across calls', () => {
    const { result: r1 } = renderHook(() => useThreadKeyStore());
    const { result: r2 } = renderHook(() => useThreadKeyStore());
    expect(r1.current).toBe(r2.current);
  });

  it('returns a fresh store after _resetGlobalStore', () => {
    const { result: r1 } = renderHook(() => useThreadKeyStore());
    const store1 = r1.current;
    _resetGlobalStore();
    const { result: r2 } = renderHook(() => useThreadKeyStore());
    expect(r2.current).not.toBe(store1);
  });
});

describe('useThreadKeyLoader', () => {
  beforeEach(() => {
    _resetGlobalStore();
    vi.clearAllMocks();
    mockFetchEvents.mockResolvedValue(new Set());
  });

  it('starts unloaded with zero keys', () => {
    const { result } = renderHook(() => useThreadKeyLoader());
    expect(result.current.loaded).toBe(false);
    expect(result.current.keyCount).toBe(0);
  });

  it('loads and unwraps a key-wrap event', async () => {
    const threadSk = generateSecretKey();
    const threadPk = getPublicKey(threadSk);
    const granterSk = generateSecretKey();
    const granterPk = getPublicKey(granterSk);

    const wrapEvent = makeKeyWrapEvent(threadSk, granterSk, RECIPIENT_PK);
    mockFetchEvents.mockResolvedValue(new Set([wrapEvent]));

    // Simulate the signer decrypting with the recipient's secret key
    mockSigner.nip44Decrypt.mockImplementation(
      async (senderPubkey: string, ciphertext: string) => {
        const ck = nip44.v2.utils.getConversationKey(RECIPIENT_SK, senderPubkey);
        return nip44.v2.decrypt(ciphertext, ck);
      },
    );

    const { result } = renderHook(() => useThreadKeyLoader());

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    expect(result.current.keyCount).toBe(1);
    expect(mockSigner.nip44Decrypt).toHaveBeenCalledOnce();
    expect(mockSigner.nip44Decrypt).toHaveBeenCalledWith(
      granterPk,
      wrapEvent.content,
    );

    // Verify the key is actually in the store
    const { result: storeResult } = renderHook(() => useThreadKeyStore());
    expect(storeResult.current.has(threadPk)).toBe(true);
    expect(storeResult.current.exportHex(threadPk)).toBe(bytesToHex(threadSk));
  });

  it('skips events with no d tag', async () => {
    const event = {
      id: 'no-d-tag',
      pubkey: '1'.repeat(64),
      kind: KEY_WRAP_KIND,
      content: 'irrelevant',
      created_at: 0,
      tags: [['p', RECIPIENT_PK]],
    };
    mockFetchEvents.mockResolvedValue(new Set([event]));

    const { result } = renderHook(() => useThreadKeyLoader());

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    expect(result.current.keyCount).toBe(0);
    expect(mockSigner.nip44Decrypt).not.toHaveBeenCalled();
  });

  it('skips wraps whose decrypted value is not a 64-char hex string', async () => {
    const event = {
      id: 'bad-content',
      pubkey: getPublicKey(generateSecretKey()),
      kind: KEY_WRAP_KIND,
      content: 'some-ciphertext',
      created_at: 0,
      tags: [
        ['d', '2'.repeat(64)],
        ['p', RECIPIENT_PK],
      ],
    };
    mockFetchEvents.mockResolvedValue(new Set([event]));
    mockSigner.nip44Decrypt.mockResolvedValue('not-a-hex-key');

    const { result } = renderHook(() => useThreadKeyLoader());

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    expect(result.current.keyCount).toBe(0);
  });

  it('survives a decrypt failure on one wrap and processes the rest', async () => {
    const goodThreadSk = generateSecretKey();
    const goodThreadPk = getPublicKey(goodThreadSk);

    const badEvent = {
      id: 'bad-wrap',
      pubkey: getPublicKey(generateSecretKey()),
      kind: KEY_WRAP_KIND,
      content: 'garbled',
      created_at: 0,
      tags: [
        ['d', '3'.repeat(64)],
        ['p', RECIPIENT_PK],
      ],
    };

    const goodEvent = {
      id: 'good-wrap',
      pubkey: getPublicKey(generateSecretKey()),
      kind: KEY_WRAP_KIND,
      content: 'valid-ciphertext',
      created_at: 1,
      tags: [
        ['d', goodThreadPk],
        ['p', RECIPIENT_PK],
      ],
    };

    mockFetchEvents.mockResolvedValue(new Set([badEvent, goodEvent]));

    let callCount = 0;
    mockSigner.nip44Decrypt.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('decrypt failed');
      return bytesToHex(goodThreadSk);
    });

    const { result } = renderHook(() => useThreadKeyLoader());

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    // One key loaded despite the first failing
    expect(result.current.keyCount).toBe(1);
  });
});
