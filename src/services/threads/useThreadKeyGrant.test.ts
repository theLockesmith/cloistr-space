/**
 * @fileoverview Tests for useThreadKeyGrant.
 *
 * The grant hook publishes a key-wrap event (kind 24242) containing a thread's
 * secret key NIP-44 encrypted to a recipient. These tests verify the happy
 * path, missing-key rejection, and missing-signer rejection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { ThreadKeyStore, KEY_WRAP_KIND } from './threadKeyStore';

// ---- Test keys ----

const threadSk = generateSecretKey();
const threadPk = getPublicKey(threadSk);
const recipientPk = getPublicKey(generateSecretKey());

// ---- Mocks ----

const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockCreateEvent = vi.fn(() => ({
  kind: 0,
  content: '',
  tags: [] as string[][],
}));
const mockNip44Encrypt = vi.fn().mockResolvedValue('encrypted-content');

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({
    publish: mockPublish,
    createEvent: mockCreateEvent,
    isConnected: true,
    subscribe: vi.fn(),
    service: null,
    isConnecting: false,
    relayStatuses: new Map(),
    reconnect: vi.fn(),
    fetchEvents: vi.fn(),
    fetchFromOwnRelays: null,
  }),
}));

const testKeyStore = new ThreadKeyStore();
testKeyStore.set(threadPk, threadSk);

vi.mock('./useThreadKeyStore', () => ({
  useThreadKeyStore: () => testKeyStore,
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    signer: {
      nip44Encrypt: mockNip44Encrypt,
      nip44Decrypt: vi.fn(),
      getPublicKey: vi.fn(),
      signEvent: vi.fn(),
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    },
    pubkey: '1'.repeat(64),
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

// ---- Tests ----

describe('useThreadKeyGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublish.mockResolvedValue(undefined);
    mockNip44Encrypt.mockResolvedValue('encrypted-content');
  });

  it('publishes a key-wrap event with the right kind, tags and encrypted content', async () => {
    const { useThreadKeyGrant } = await import('./useThreadKeyGrant');
    const { result } = renderHook(() => useThreadKeyGrant());

    expect(result.current.canGrant).toBe(true);

    await act(async () => {
      await result.current.grantKey(threadPk, recipientPk);
    });

    // The signer was asked to encrypt the thread key to the recipient
    expect(mockNip44Encrypt).toHaveBeenCalledOnce();
    expect(mockNip44Encrypt).toHaveBeenCalledWith(
      recipientPk,
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );

    // An event was created and published
    expect(mockCreateEvent).toHaveBeenCalledOnce();
    expect(mockPublish).toHaveBeenCalledOnce();

    const publishedEvent = mockPublish.mock.calls[0][0];
    expect(publishedEvent.kind).toBe(KEY_WRAP_KIND);
    expect(publishedEvent.content).toBe('encrypted-content');
    expect(publishedEvent.tags).toContainEqual(['d', threadPk]);
    expect(publishedEvent.tags).toContainEqual(['p', recipientPk]);
  });

  it('throws when the thread key is not held', async () => {
    vi.resetModules();
    const emptyStore = new ThreadKeyStore();
    vi.doMock('./useThreadKeyStore', () => ({
      useThreadKeyStore: () => emptyStore,
    }));
    vi.doMock('@/services/nostr', () => ({
      useNdk: () => ({
        publish: mockPublish,
        createEvent: mockCreateEvent,
        isConnected: true,
        subscribe: vi.fn(),
        service: null,
        isConnecting: false,
        relayStatuses: new Map(),
        reconnect: vi.fn(),
        fetchEvents: vi.fn(),
        fetchFromOwnRelays: null,
      }),
    }));
    vi.doMock('@/components/auth/AuthProvider', () => ({
      useAuth: () => ({
        signer: {
          nip44Encrypt: mockNip44Encrypt,
          nip44Decrypt: vi.fn(),
          getPublicKey: vi.fn(),
          signEvent: vi.fn(),
          encrypt: vi.fn(),
          decrypt: vi.fn(),
        },
        pubkey: '1'.repeat(64),
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

    const { useThreadKeyGrant } = await import('./useThreadKeyGrant');
    const { result } = renderHook(() => useThreadKeyGrant());

    const unknownThreadPk = getPublicKey(generateSecretKey());
    await expect(
      act(async () => {
        await result.current.grantKey(unknownThreadPk, recipientPk);
      })
    ).rejects.toThrow(/thread key not held/);

    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('throws when the signer has no NIP-44 encrypt', async () => {
    vi.resetModules();
    vi.doMock('./useThreadKeyStore', () => ({
      useThreadKeyStore: () => testKeyStore,
    }));
    vi.doMock('@/services/nostr', () => ({
      useNdk: () => ({
        publish: mockPublish,
        createEvent: mockCreateEvent,
        isConnected: true,
        subscribe: vi.fn(),
        service: null,
        isConnecting: false,
        relayStatuses: new Map(),
        reconnect: vi.fn(),
        fetchEvents: vi.fn(),
        fetchFromOwnRelays: null,
      }),
    }));
    vi.doMock('@/components/auth/AuthProvider', () => ({
      useAuth: () => ({
        signer: {
          // No nip44Encrypt
          nip44Decrypt: vi.fn(),
          getPublicKey: vi.fn(),
          signEvent: vi.fn(),
          encrypt: vi.fn(),
          decrypt: vi.fn(),
        },
        pubkey: '1'.repeat(64),
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

    const { useThreadKeyGrant } = await import('./useThreadKeyGrant');
    const { result } = renderHook(() => useThreadKeyGrant());

    await expect(
      act(async () => {
        await result.current.grantKey(threadPk, recipientPk);
      })
    ).rejects.toThrow(/NIP-44 encryption/);

    expect(mockPublish).not.toHaveBeenCalled();
  });
});
