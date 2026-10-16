/**
 * @fileoverview React side of projectSetup.ts: check whether the signed-in
 * owner's project was left half-made, and finish it on request.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNdk, useHeadlessAdapters, type NDKFilter } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { RelayProbe } from '../headless';
import { checkProjectSetup, finishProjectSetup, type ProjectSetupCheck } from './projectSetup';

export interface UseProjectSetupReturn {
  /** null while checking. */
  check: ProjectSetupCheck | null;
  finish: () => Promise<void>;
  isBusy: boolean;
  error: string | null;
  notice: string | null;
}

export function useProjectSetup(groupId: string): UseProjectSetupReturn {
  const { isConnected, probeOwnRelays } = useNdk();
  const { pubkey } = useAuthStore();
  const { signer, relay } = useHeadlessAdapters();

  const [check, setCheck] = useState<ProjectSetupCheck | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const probe = useMemo<RelayProbe | null>(
    () => (probeOwnRelays ? (filter) => probeOwnRelays(filter as NDKFilter) : null),
    [probeOwnRelays],
  );

  useEffect(() => {
    if (!isConnected || !pubkey || !probe) return;
    let cancelled = false;
    void checkProjectSetup(pubkey, probe, groupId).then((result) => {
      if (!cancelled) setCheck(result);
    });
    return () => {
      cancelled = true;
    };
  }, [isConnected, pubkey, probe, groupId]);

  const finish = useCallback(async () => {
    if (!signer || !relay || !probe) {
      setError('Not connected');
      return;
    }
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await finishProjectSetup(signer, relay, probe, groupId);
      if (!result.ok) {
        setNotice(result.reason);
        return;
      }
      setCheck({ status: 'complete' });
      setNotice('Project set up. You can add members now.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change was not saved.');
    } finally {
      setIsBusy(false);
    }
  }, [signer, relay, probe, groupId]);

  return { check, finish, isBusy, error, notice };
}
