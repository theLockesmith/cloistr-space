/**
 * @fileoverview NDK-backed SignerInterface + RelayClient for components.
 *
 * Memoizes the factory in ndkAdapters.ts over the NDK context. See there for
 * why signing and publishing are separate jobs.
 */

import { useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import type { SignerInterface, RelayClient } from '../headless';
import { useNdk } from './NdkProvider';
import { makeNdkRelay, makeNdkSigner } from './ndkAdapters';

export interface HeadlessAdapters {
  /** Null until there is a pubkey and an NDK instance to sign with. */
  signer: SignerInterface | null;
  /** Null until NDK exists. Publishing still needs a connection to succeed. */
  relay: RelayClient | null;
}

export function useHeadlessAdapters(): HeadlessAdapters {
  const { createEvent, publish, fetchFromOwnRelays } = useNdk();
  const { pubkey } = useAuthStore();

  const signer = useMemo<SignerInterface | null>(() => {
    if (!pubkey || !publish) return null;
    return makeNdkSigner({ createEvent, publish, fetchFromOwnRelays }, async () => pubkey);
  }, [pubkey, createEvent, publish, fetchFromOwnRelays]);

  const relay = useMemo<RelayClient | null>(() => {
    if (!publish) return null;
    return makeNdkRelay({ createEvent, publish, fetchFromOwnRelays });
  }, [createEvent, publish, fetchFromOwnRelays]);

  return { signer, relay };
}
