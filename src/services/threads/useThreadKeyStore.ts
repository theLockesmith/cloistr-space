/**
 * @fileoverview React integration for the ThreadKeyStore.
 *
 * Provides a singleton store accessible via a hook, and a loader that fetches
 * key-wrap events from relays and unwraps them through the user's signer.
 *
 * The store is cleared on logout (pubkey change).
 */

import { useMemo, useEffect, useState } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { useNdk } from '@/services/nostr';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthStore } from '@/stores/authStore';
import { ThreadKeyStore, KEY_WRAP_KIND } from './threadKeyStore';

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
export function useThreadKeyLoader(): { loaded: boolean; keyCount: number } {
  const { fetchEvents, isConnected } = useNdk();
  const { signer } = useAuth();
  const { pubkey } = useAuthStore();
  const store = useThreadKeyStore();
  const [loaded, setLoaded] = useState(false);
  const [keyCount, setKeyCount] = useState(0);

  useEffect(() => {
    const decrypt = signer?.nip44Decrypt?.bind(signer);
    if (!fetchEvents || !isConnected || !pubkey || !decrypt) {
      return;
    }

    // Already loaded for this pubkey
    if (loaded && store.size > 0) return;

    const filter: NDKFilter = {
      kinds: [KEY_WRAP_KIND as number],
      '#p': [pubkey],
    };

    let cancelled = false;

    (async () => {
      try {
        const events = await fetchEvents([filter]);

        for (const event of events) {
          if (cancelled) break;

          // The `d` tag carries the thread's public key — the identifier we
          // key the store on.
          const dTag = event.tags.find((t: string[]) => t[0] === 'd');
          if (!dTag?.[1]) continue;

          const threadPubkey = dTag[1];

          // Already have this key (from a prior load or a different wrap)
          if (store.has(threadPubkey)) continue;

          try {
            // The event content is the thread's secret key, NIP-44 encrypted
            // to the member (us). The sender is the event's author (the granter).
            const secretKeyHex = await decrypt(
              event.pubkey,
              event.content
            );

            if (secretKeyHex && /^[0-9a-f]{64}$/i.test(secretKeyHex)) {
              store.importHex(threadPubkey, secretKeyHex);
              if (!cancelled) setKeyCount(store.size);
            }
          } catch {
            // Decryption failure for this wrap — skip silently. Could be a
            // key rotation where the old wrap has not been garbage-collected,
            // or a wrap intended for a different key the user no longer holds.
          }
        }

        if (!cancelled) setLoaded(true);
      } catch (err) {
        console.warn('[ThreadKeyLoader] Failed to fetch key wraps:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  // loaded is read inside but deliberately excluded from deps: adding it would
  // re-trigger the effect every time it flips, creating an infinite loop. The
  // guard `loaded && store.size > 0` is the intended short-circuit for a
  // second mount/render, not a reactive dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchEvents, isConnected, pubkey, signer, store]);

  // Derive loaded/keyCount reset from pubkey: when no user is logged in, the
  // store is empty and loading has not happened. The store is cleared as a
  // side effect (it is a singleton, not React state) and the derived values
  // collapse to their initial state without calling setState.
  const effectiveLoaded = pubkey ? loaded : false;
  const effectiveKeyCount = pubkey ? keyCount : 0;

  // Clear the singleton store when the user logs out.
  useEffect(() => {
    if (!pubkey) {
      store.clear();
    }
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
