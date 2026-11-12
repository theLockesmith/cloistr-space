/**
 * @fileoverview React integration for the ThreadKeyStore.
 *
 * Provides a singleton store accessible via a hook, and a loader that restores
 * the user's saved keys through their signer.
 *
 * The store is cleared on sign-out and on an account switch.
 */

import { useMemo, useEffect, useState, useRef } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthStore } from '@/stores/authStore';
import { ThreadKeyStore } from './threadKeyStore';
import { clearKeyWraps } from './pendingKeyOffers';
import {
  loadThreadKeys,
  clearThreadKeys,
  type StorageAdapter,
} from './threadKeyPersistence';

/**
 * Singleton — one store per app lifetime, cleared on logout.
 *
 * A singleton is correct here because thread keys are user-scoped and the app
 * has exactly one logged-in user. A per-component store would re-fetch wraps
 * on every mount.
 */
let globalStore: ThreadKeyStore | null = null;

function getStore(): ThreadKeyStore {
  if (!globalStore) {
    globalStore = new ThreadKeyStore();
  }
  return globalStore;
}

/**
 * Get the thread key store. Does NOT restore saved keys: useThreadKeyLoader,
 * mounted in MainLayout, does that.
 */
export function useThreadKeyStore(): ThreadKeyStore {
  return useMemo(() => getStore(), []);
}

function getStorageAdapter(): StorageAdapter | null {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.getItem('__probe__');
      return localStorage;
    }
  } catch {
    // Private browsing or storage blocked
  }
  return null;
}

/**
 * Restore the signed-in user's saved thread keys into the store, and drop them
 * from memory when the user signs out or another key signs in.
 *
 * Mounted once, in MainLayout. Without it a private thread lasts only as long
 * as its hand-off stays on the relays (about two days): keys were saved on
 * every hand-off and never read back after the P3 screens removed this
 * hook's only caller (2026-10-26).
 *
 * Kind 24242 key-wraps are no longer fetched: that kind is in the ephemeral
 * range, so relays never store one and the fetch could only return nothing.
 * Keys arrive by bucketed hand-off (useBucketReader).
 */
export function useThreadKeyLoader(): { loaded: boolean; keyCount: number } {
  const { signer } = useAuth();
  const { pubkey } = useAuthStore();
  const store = useThreadKeyStore();
  const [restored, setRestored] = useState<{ owner: string; keyCount: number } | null>(null);

  useEffect(() => {
    const decrypt = signer?.nip44Decrypt?.bind(signer);
    if (!pubkey || !decrypt) return;

    const storage = getStorageAdapter();
    if (!storage) return;

    let cancelled = false;

    (async () => {
      try {
        const persisted = await loadThreadKeys(pubkey, decrypt, storage);
        // Signed out or switched while the signer was answering: these keys
        // belong to the previous account and must not enter the store.
        if (cancelled || useAuthStore.getState().pubkey !== pubkey) return;
        for (const { threadPubkey, secretHex, threadId } of persisted) {
          if (threadId) store.setName(threadPubkey, threadId);
          if (!store.has(threadPubkey)) {
            store.importHex(threadPubkey, secretHex);
          }
        }
        setRestored({ owner: pubkey, keyCount: store.size });
      } catch {
        // Storage unavailable or corrupted: hand-offs on the relays still arrive
      }
    })();

    return () => { cancelled = true; };

  }, [pubkey, signer, store]);

  const prevPubkeyRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevPubkeyRef.current;
    if (prev && pubkey !== prev) {
      // Another account's keys must not read this account's threads. Only a
      // sign-out also deletes the saved copy: a switch may come back.
      store.clear();
      clearKeyWraps();
      if (!pubkey) {
        const storage = getStorageAdapter();
        if (storage) clearThreadKeys(prev, storage);
      }
    }
    prevPubkeyRef.current = pubkey;
  }, [pubkey, store]);

  const mine = pubkey && restored?.owner === pubkey ? restored : null;
  return { loaded: Boolean(mine), keyCount: mine?.keyCount ?? 0 };
}

/**
 * Reset the global store. Exported for tests.
 */
export function _resetGlobalStore(): void {
  globalStore?.clear();
  globalStore = null;
}
