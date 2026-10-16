/**
 * @fileoverview Tests for useThreadKeyStore and useThreadKeyLoader.
 *
 * These are React hook tests, so they run inside renderHook. The hooks depend
 * on useNdk, useAuth, and useAuthStore, all mocked at the module level. The
 * singleton store is reset between tests via _resetGlobalStore.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { generateSecretKey, getPublicKey, nip44, utils as ntUtils } from 'nostr-tools';
import {
  useThreadKeyStore,
  useThreadKeyLoader,
  _resetGlobalStore,
} from './useThreadKeyStore';
import { KEY_WRAP_KIND } from './threadKeyStore';
import { usePendingKeyWraps, acceptKeyWrap, dismissKeyWrap, clearKeyWraps } from './pendingKeyOffers';

const { bytesToHex } = ntUtils;

// A real recipient keypair so NIP-44 conversation key derivation works.
const RECIPIENT_SK = generateSecretKey();
const RECIPIENT_PK = getPublicKey(RECIPIENT_SK);

// ---- Mocks ----

/** Fleet granters: the only key-wrap senders taken without asking. */
const fleet = vi.hoisted(() => ({ granters: [] as string[] }));
vi.mock('@/config/environment', () => ({
  config: {
    get threadGranters() {
      return fleet.granters;
    },
  },
}));

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
  // These tests exercise the loader with a trusted sender; a stranger's
  // key-wrap is held instead (see the security tests at the end).
  if (!fleet.granters.includes(granterPk)) fleet.granters.push(granterPk);

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

  it('delegated member unwraps a key and reads a message from a third-party author', async () => {
    // Scenario: Alice (granter) wraps a thread key to Bob (RECIPIENT).
    // Carol (a third author, neither granter nor recipient) encrypts a message
    // using the thread key. After the loader unwraps, Bob can decrypt Carol's
    // message. This proves the full read path works for a delegated member
    // who is not the thread creator.
    const threadSk = generateSecretKey();
    const threadPk = getPublicKey(threadSk);
    const aliceSk = generateSecretKey(); // granter
    const carolSk = generateSecretKey(); // third-party author
    const carolPk = getPublicKey(carolSk);

    // Alice wraps the thread key to Bob (RECIPIENT)
    const wrapEvent = makeKeyWrapEvent(threadSk, aliceSk, RECIPIENT_PK);
    mockFetchEvents.mockResolvedValue(new Set([wrapEvent]));

    // Bob's signer decrypts the wrap from Alice
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

    // Carol encrypts a message using the thread key
    const carolMessage = 'The deploy pipeline is broken on staging.';
    const ck = nip44.v2.utils.getConversationKey(threadSk, carolPk);
    const ciphertext = nip44.v2.encrypt(carolMessage, ck);

    // Bob (RECIPIENT) reads Carol's message using the unwrapped thread key
    const { result: storeResult } = renderHook(() => useThreadKeyStore());
    const storedSk = storeResult.current.get(threadPk);
    expect(storedSk).toBeDefined();

    const readCk = nip44.v2.utils.getConversationKey(storedSk!, carolPk);
    const plaintext = nip44.v2.decrypt(ciphertext, readCk);
    expect(plaintext).toBe(carolMessage);
  });

  it('a wrap addressed to someone else yields no keys for the current user', async () => {
    // Negative control: a key-wrap event exists but its p-tag points at a
    // different pubkey (Eve). Even if the relay returns it loosely, the
    // current user (RECIPIENT) cannot derive the right conversation key to
    // decrypt it, so the store stays empty. Without this test a loader that
    // ignores the wrap entirely looks identical to one that works.
    const threadSk = generateSecretKey();
    const granterSk = generateSecretKey();
    const eveSk = generateSecretKey();
    const evePk = getPublicKey(eveSk);

    // Wrap is addressed to Eve, not to RECIPIENT
    const wrapEvent = makeKeyWrapEvent(threadSk, granterSk, evePk);
    mockFetchEvents.mockResolvedValue(new Set([wrapEvent]));

    // RECIPIENT's signer tries to decrypt with its own key, which produces
    // the wrong conversation key and the decrypt throws
    mockSigner.nip44Decrypt.mockImplementation(
      async (senderPubkey: string, ciphertext: string) => {
        const ck = nip44.v2.utils.getConversationKey(RECIPIENT_SK, senderPubkey);
        // This will throw because the ciphertext was encrypted to Eve, not us
        return nip44.v2.decrypt(ciphertext, ck);
      },
    );

    const { result } = renderHook(() => useThreadKeyLoader());

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    // No keys loaded: the wrap was not for us
    expect(result.current.keyCount).toBe(0);
    expect(mockSigner.nip44Decrypt).toHaveBeenCalledOnce();
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

    // From a fleet granter, so its key is taken without a prompt.
    const fleetGranterPk = getPublicKey(generateSecretKey());
    fleet.granters.push(fleetGranterPk);
    const goodEvent = {
      id: 'good-wrap',
      pubkey: fleetGranterPk,
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

/**
 * Security (2026-10-16): anyone can publish a key-wrap tagged to any pubkey.
 * NIP-44 is symmetric, so a stranger who knows only the victim's pubkey can
 * encrypt a thread key the victim's signer will open. The loader used to
 * import it silently; now only the fleet granters' key-wraps are taken as
 * they come, and anyone else's waits for the user.
 */
describe('useThreadKeyLoader with a key-wrap from a stranger', () => {
  /** Built from public information only: the victim's pubkey. */
  function strangerKeyWrap(threadSk: Uint8Array) {
    const strangerSk = generateSecretKey();
    const threadPk = getPublicKey(threadSk);
    return {
      id: 'stranger-' + threadPk.slice(0, 8),
      pubkey: getPublicKey(strangerSk),
      kind: KEY_WRAP_KIND,
      content: nip44.v2.encrypt(bytesToHex(threadSk), nip44.v2.utils.getConversationKey(strangerSk, RECIPIENT_PK)),
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', threadPk], ['p', RECIPIENT_PK]],
    };
  }

  beforeEach(() => {
    clearKeyWraps();
    try { localStorage.clear(); } catch { /* none */ }
    mockSigner.nip44Decrypt.mockImplementation(async (senderPubkey: string, ciphertext: string) =>
      nip44.v2.decrypt(ciphertext, nip44.v2.utils.getConversationKey(RECIPIENT_SK, senderPubkey)),
    );
  });

  it('holds the key for the user instead of importing it', async () => {
    const threadSk = generateSecretKey();
    mockFetchEvents.mockResolvedValue(new Set([strangerKeyWrap(threadSk)]));

    const { result } = renderHook(() => ({ loader: useThreadKeyLoader(), offers: usePendingKeyWraps(), store: useThreadKeyStore() }));
    await waitFor(() => expect(result.current.loader.loaded).toBe(true));

    expect(result.current.store.has(getPublicKey(threadSk))).toBe(false);
    expect(result.current.offers).toHaveLength(1);
    expect(result.current.offers[0].threadPubkey).toBe(getPublicKey(threadSk));
  });

  it('imports it only when the user accepts', async () => {
    const threadSk = generateSecretKey();
    mockFetchEvents.mockResolvedValue(new Set([strangerKeyWrap(threadSk)]));
    const { result } = renderHook(() => ({ loader: useThreadKeyLoader(), offers: usePendingKeyWraps(), store: useThreadKeyStore() }));
    await waitFor(() => expect(result.current.offers).toHaveLength(1));

    act(() => {
      acceptKeyWrap(result.current.offers[0].eventId, result.current.store, RECIPIENT_PK, undefined);
    });

    expect(result.current.store.has(getPublicKey(threadSk))).toBe(true);
    expect(result.current.offers).toHaveLength(0);
  });

  it('a dismissed key-wrap is not offered again', async () => {
    const threadSk = generateSecretKey();
    const wrap = strangerKeyWrap(threadSk);
    dismissKeyWrap(wrap.id);
    mockFetchEvents.mockResolvedValue(new Set([wrap]));

    const { result } = renderHook(() => ({ loader: useThreadKeyLoader(), offers: usePendingKeyWraps(), store: useThreadKeyStore() }));
    await waitFor(() => expect(result.current.loader.loaded).toBe(true));

    expect(result.current.offers).toHaveLength(0);
    expect(result.current.store.has(getPublicKey(threadSk))).toBe(false);
  });
});
