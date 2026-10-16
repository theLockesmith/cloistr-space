/**
 * @fileoverview Signing out forgets the Activity widgets' kept reads.
 *
 * The Blossom file list and the Tasks cards are each signed once and reused,
 * keyed by pubkey. Nothing ever cleared them, so a signed-out device kept the
 * last user's file list and cards in memory. Driven through the real logout.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';

const ME = 'ab'.repeat(32);
const signEvent = vi.fn(async (e: object) => ({ ...e, id: 'id', sig: 'sig' }));
const signer = { getPublicKey: async () => ME, signEvent };
const fetchMock = vi.fn();

vi.mock('@cloistr/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cloistr/auth')>();
  const shared = {
    authState: { isConnected: false, isConnecting: false, pubkey: null, activePubkey: null, method: null, isSwitching: false },
    signer: null,
  };
  return { ...actual, useNostrAuth: () => shared };
});
vi.mock('@cloistr/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cloistr/ui')>();
  return { ...actual, getSharedSession: () => null, saveSharedSession: vi.fn(), clearSharedSession: vi.fn() };
});
vi.mock('@/services/nostr', () => ({ useHeadlessAdapters: () => ({ signer, relay: null }) }));
vi.mock('@/services/cache', () => ({ clearAll: vi.fn(async () => {}) }));
vi.mock('@/config/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/environment')>();
  return { config: { ...actual.config, blossomApiUrl: 'https://files.example', tasksUrl: 'https://tasks.example' } };
});

const { AuthProvider, useAuth } = await import('./AuthProvider');
const { useAuthStore } = await import('@/stores/authStore');
const { listBlossomFiles, clearBlossomSession } = await import('@/services/activity/fileSources');
const { useTaskCards, clearTaskCardsCache } = await import('@/services/activity/useTaskCards');

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

beforeEach(() => {
  clearBlossomSession();
  clearTaskCardsCache();
  localStorage.clear();
  useAuthStore.getState().login(ME, 'nip46');
  signEvent.mockClear();
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
  vi.stubGlobal('fetch', fetchMock);
});

async function signOut() {
  const { result } = renderHook(() => useAuth(), { wrapper });
  await act(async () => {
    await result.current.logout();
  });
}

describe('sign-out', () => {
  // The same key signs back in afterwards: a cache keyed by pubkey would
  // still serve it, so only a real clear makes it sign again.
  it('forgets the Blossom file list', async () => {
    await listBlossomFiles(signer as never, ME);
    await listBlossomFiles(signer as never, ME);
    expect(signEvent).toHaveBeenCalledTimes(1);

    await signOut();
    useAuthStore.getState().login(ME, 'nip46');

    await listBlossomFiles(signer as never, ME);
    expect(signEvent).toHaveBeenCalledTimes(2);
  });

  it('forgets the Tasks cards', async () => {
    const first = renderHook(() => useTaskCards());
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    first.unmount();
    expect(signEvent).toHaveBeenCalledTimes(1);

    await signOut();
    useAuthStore.getState().login(ME, 'nip46');

    const second = renderHook(() => useTaskCards());
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(signEvent).toHaveBeenCalledTimes(2);
  });
});
