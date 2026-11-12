/**
 * @fileoverview Tests for useThreadKeyStore and useThreadKeyLoader.
 *
 * These are React hook tests, so they run inside renderHook. The loader
 * depends on useAuth and useAuthStore, both mocked at the module level. The
 * singleton store is reset between tests via _resetGlobalStore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { generateSecretKey, getPublicKey, nip44, utils as ntUtils } from 'nostr-tools';
import {
  useThreadKeyStore,
  useThreadKeyLoader,
  _resetGlobalStore,
} from './useThreadKeyStore';
import { dismissKeyWrap, loadDismissed, MAX_DISMISSED } from './pendingKeyOffers';

const { bytesToHex } = ntUtils;

const USER_SK = generateSecretKey();
const USER_PK = getPublicKey(USER_SK);

// ---- Mocks ----

const auth = vi.hoisted(() => ({ pubkey: null as string | null }));

const mockSigner = {
  nip44Decrypt: vi.fn(),
  getPublicKey: vi.fn(),
  signEvent: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
};

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ signer: mockSigner, pubkey: auth.pubkey }),
}));

vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => ({ pubkey: auth.pubkey });
  useAuthStore.getState = () => ({ pubkey: auth.pubkey });
  return { useAuthStore };
});

// ---- Helpers ----

/** Save a thread key for USER_PK the way saveThreadKey does: NIP-44 to self. */
function saveKey(threadSk: Uint8Array, threadId?: string) {
  const selfCk = nip44.v2.utils.getConversationKey(USER_SK, USER_PK);
  const plaintext = threadId ? JSON.stringify({ k: bytesToHex(threadSk), t: threadId }) : bytesToHex(threadSk);
  const key = 'cloistr:thread-keys:' + USER_PK;
  const existing = JSON.parse(localStorage.getItem(key) ?? '{}');
  existing[getPublicKey(threadSk)] = nip44.v2.encrypt(plaintext, selfCk);
  localStorage.setItem(key, JSON.stringify(existing));
}

function decryptAsUser(pk: string, ct: string) {
  return Promise.resolve(nip44.v2.decrypt(ct, nip44.v2.utils.getConversationKey(USER_SK, pk)));
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
    localStorage.clear();
    auth.pubkey = USER_PK;
    mockSigner.nip44Decrypt.mockImplementation(decryptAsUser);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts unloaded with zero keys', () => {
    mockSigner.nip44Decrypt.mockImplementation(() => new Promise(() => {}));
    saveKey(generateSecretKey());
    const { result } = renderHook(() => useThreadKeyLoader());
    expect(result.current.loaded).toBe(false);
    expect(result.current.keyCount).toBe(0);
  });

  it('a reload restores each saved thread name with its key', async () => {
    const threadSk = generateSecretKey();
    const threadPk = getPublicKey(threadSk);
    saveKey(threadSk, 'cloistr-group-wrap');

    const { result } = renderHook(() => ({ loader: useThreadKeyLoader(), store: useThreadKeyStore() }));
    await waitFor(() => expect(result.current.loader.loaded).toBe(true));
    expect(result.current.loader.keyCount).toBe(1);
    expect(result.current.store.names().get(threadPk)).toBe('cloistr-group-wrap');
    expect(result.current.store.exportHex(threadPk)).toBe(bytesToHex(threadSk));
  });

  it('restores a key saved before names were kept', async () => {
    const threadSk = generateSecretKey();
    saveKey(threadSk);

    const { result } = renderHook(() => ({ loader: useThreadKeyLoader(), store: useThreadKeyStore() }));
    await waitFor(() => expect(result.current.loader.loaded).toBe(true));
    expect(result.current.store.exportHex(getPublicKey(threadSk))).toBe(bytesToHex(threadSk));
  });

  it('switching account drops the previous account\'s keys from memory but keeps its saved copy', async () => {
    const threadSk = generateSecretKey();
    saveKey(threadSk);

    const { result, rerender } = renderHook(() => ({ loader: useThreadKeyLoader(), store: useThreadKeyStore() }));
    await waitFor(() => expect(result.current.store.size).toBe(1));

    auth.pubkey = getPublicKey(generateSecretKey());
    rerender();

    expect(result.current.store.size).toBe(0);
    expect(result.current.loader.loaded).toBe(false);
    expect(localStorage.getItem('cloistr:thread-keys:' + USER_PK)).not.toBeNull();
  });

  it('signing out drops the keys and deletes the saved copy', async () => {
    saveKey(generateSecretKey());

    const { result, rerender } = renderHook(() => ({ loader: useThreadKeyLoader(), store: useThreadKeyStore() }));
    await waitFor(() => expect(result.current.store.size).toBe(1));

    auth.pubkey = null;
    rerender();

    expect(result.current.store.size).toBe(0);
    expect(localStorage.getItem('cloistr:thread-keys:' + USER_PK)).toBeNull();
  });

  it('keys still being decrypted when another account signs in never reach the store', async () => {
    saveKey(generateSecretKey());
    let answer!: () => void;
    const gate = new Promise<void>((res) => { answer = res; });
    mockSigner.nip44Decrypt.mockImplementation(async (pk: string, ct: string) => {
      await gate;
      return decryptAsUser(pk, ct);
    });

    const { result, rerender } = renderHook(() => ({ loader: useThreadKeyLoader(), store: useThreadKeyStore() }));
    auth.pubkey = getPublicKey(generateSecretKey());
    rerender();
    await act(async () => {
      answer();
      await gate;
    });

    expect(result.current.store.size).toBe(0);
  });
});

describe('remembered refusals', () => {
  it('keep only the newest MAX_DISMISSED', () => {
    localStorage.clear();
    for (let i = 0; i < MAX_DISMISSED + 5; i++) dismissKeyWrap(`offer-${i}`);
    const kept = loadDismissed();
    expect(kept.size).toBe(MAX_DISMISSED);
    expect(kept.has('offer-0')).toBe(false);
    expect(kept.has(`offer-${MAX_DISMISSED + 4}`)).toBe(true);
  });
});
