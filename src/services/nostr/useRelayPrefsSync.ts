/**
 * @fileoverview Apply the user's own relay preferences once they are known.
 *
 * Mounted alongside useContactsSync in MainLayout. Both do the same shape of
 * thing -- resolve something that is per-identity and cannot be known until
 * after auth -- so they belong at the same level rather than buried in a
 * provider.
 */

import { useEffect, useRef, useState } from 'react';
import { useNdk } from './NdkProvider';
import { useAuthStore } from '@/stores/authStore';
import { resolveAndApplyRelays, type ResolveResult } from './relayPrefs';

export interface UseRelayPrefsSyncReturn {
  result: ResolveResult | null;
  error: string | null;
}

export function useRelayPrefsSync(): UseRelayPrefsSyncReturn {
  const { service, isConnected } = useNdk();
  const pubkey = useAuthStore((s) => s.pubkey);

  const [result, setResult] = useState<ResolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keyed by pubkey rather than a boolean: relay preferences follow the signing
  // pubkey, so switching identity has to re-resolve rather than keep the
  // previous key's relays. Same reasoning as the contacts auto-import.
  const resolvedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!service || !isConnected || !pubkey) return;
    if (resolvedForRef.current === pubkey) return;

    resolvedForRef.current = pubkey;
    let cancelled = false;

    // Deferred so the resolve, and the setConfiguredRelays it performs, do not
    // run synchronously inside the effect body.
    const timeoutId = setTimeout(() => {
      resolveAndApplyRelays(service, pubkey)
        .then((r) => {
          if (!cancelled) setResult(r);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // Non-fatal on purpose. Failing to resolve leaves the pool on its
          // existing relays, which is degraded but usable; tearing the session
          // down over it would be worse than the problem.
          setError(err instanceof Error ? err.message : 'Could not resolve your relays');
          // Allow a retry on the next mount or key change.
          resolvedForRef.current = null;
        });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [service, isConnected, pubkey]);

  return { result, error };
}
