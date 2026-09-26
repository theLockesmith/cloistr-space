/**
 * @fileoverview React integration for the ThreadKeyStore.
 *
 * Provides a singleton store accessible via a hook, and a loader that fetches
 * key-wrap events from relays and unwraps them through the user's signer.
 *
 * The store is cleared on logout (pubkey change).
 */

import { useMemo, useEffect, useState, useRef } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { bytesToHex } from 'nostr-tools/utils';
import { useNdk } from '@/services/nostr';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthStore } from '@/stores/authStore';
import { ThreadKeyStore, KEY_WRAP_KIND } from './threadKeyStore';
import {
  saveThreadKey,
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
 * Get the thread key store. Does NOT trigger key-wrap loading — use
 * `useThreadKeyLoader` in a component that has access to a signer for that.
 */
export function useThreadKeyStore(): ThreadKeyStore {
  return useMemo(() => getStore(), []);
}

/**
 * Fetch key-wrap events for the current user and unwrap them into the store.
 *
 * Call once near the app root (or in the threads view). Runs when the user is
 * logged in and connected. Idempotent: re-running after the wraps are already
 * loaded is a no-op on the store side (set overwrites are harmless).
 *
 * The signer's `nip44Decrypt` is required. If the underlying signer/extension
 * does not support NIP-44, this loader silently skips — the user simply cannot
 * read sealed threads, which is the correct degradation (they can still read
 * plaintext threads).
 */
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

export function useThreadKeyLoader(): { loaded: boolean; keyCount: number } {
  const { fetchEvents, isConnected } = useNdk();
  const { signer } = useAuth();
  const { pubkey } = useAuthStore();
  const store = useThreadKeyStore();
  const [loaded, setLoaded] = useState(false);
  const [keyCount, setKeyCount] = useState(0);

  // Phase 1: load persisted keys from encrypted local storage (fast, no relay)
  useEffect(() => {
    const decrypt = signer?.nip44Decrypt?.bind(signer);
    if (!pubkey || !decrypt) return;

    const storage = getStorageAdapter();
    if (!storage) return;

    let cancelled = false;

    (async () => {
      try {
        const persisted = await loadThreadKeys(pubkey, decrypt, storage);
        for (const { threadPubkey, secretHex } of persisted) {
          if (cancelled) break;
          if (!store.has(threadPubkey)) {
            store.importHex(threadPubkey, secretHex);
          }
        }
        if (!cancelled) setKeyCount(store.size);
      } catch {
        // Storage unavailable or corrupted — relay fetch will fill the gap
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, signer, store]);

  // Phase 2: fetch key wraps from relay and persist any new keys
  useEffect(() => {
    const decrypt = signer?.nip44Decrypt?.bind(signer);
    const encrypt = signer?.nip44Encrypt?.bind(signer);
    if (!fetchEvents || !isConnected || !pubkey || !decrypt) {
      return;
    }

    if (loaded && store.size > 0) return;

    const filter: NDKFilter = {
      kinds: [KEY_WRAP_KIND as number],
      '#p': [pubkey],
    };

    const storage = getStorageAdapter();
    let cancelled = false;

    (async () => {
      try {
        const events = await fetchEvents([filter]);

        for (const event of events) {
          if (cancelled) break;

          const dTag = event.tags.find((t: string[]) => t[0] === 'd');
          if (!dTag?.[1]) continue;

          const threadPubkey = dTag[1];
          if (store.has(threadPubkey)) continue;

          try {
            const secretKeyHex = await decrypt(event.pubkey, event.content);

            if (secretKeyHex && /^[0-9a-f]{64}$/i.test(secretKeyHex)) {
              store.importHex(threadPubkey, secretKeyHex);
              if (!cancelled) setKeyCount(store.size);

              if (storage && encrypt) {
                saveThreadKey(threadPubkey, secretKeyHex, pubkey, encrypt, storage).catch(() => {});
              }
            }
          } catch {
            // Decryption failure — skip
          }
        }

        if (!cancelled) setLoaded(true);
      } catch (err) {
        console.warn('[ThreadKeyLoader] Failed to fetch key wraps:', err);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchEvents, isConnected, pubkey, signer, store]);

  const effectiveLoaded = pubkey ? loaded : false;
  const effectiveKeyCount = pubkey ? keyCount : 0;

  const prevPubkeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pubkey && prevPubkeyRef.current) {
      store.clear();
      const storage = getStorageAdapter();
      if (storage) {
        clearThreadKeys(prevPubkeyRef.current, storage);
      }
    }
    prevPubkeyRef.current = pubkey;
  }, [pubkey, store]);

  return { loaded: effectiveLoaded, keyCount: effectiveKeyCount };
}

/**
 * Reset the global store. Exported for tests.
 */
export function _resetGlobalStore(): void {
  globalStore?.clear();
  globalStore = null;
}
