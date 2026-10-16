/**
 * @fileoverview React side of projectSetup.ts: check whether the signed-in
 * owner's project was left half-made, and finish it on request.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNdk, useHeadlessAdapters } from '@/services/nostr';
import { pinRelays } from '@/services/nostr/pinnedRelays';
import { useAuthStore } from '@/stores/authStore';
import type { RelayClient, RelayProbe } from '../headless';
import { checkProjectSetup, finishProjectSetup, type ProjectSetupCheck } from './projectSetup';
import { creationMembersTemplate } from './groupService';

export interface UseProjectSetupReturn {
  /** null while checking. */
  check: ProjectSetupCheck | null;
  finish: () => Promise<void>;
  isBusy: boolean;
  error: string | null;
  notice: string | null;
}

export function useProjectSetup(groupId: string): UseProjectSetupReturn {
  const { isConnected, service } = useNdk();
  const { pubkey } = useAuthStore();
  const { signer } = useHeadlessAdapters();

  const [check, setCheck] = useState<ProjectSetupCheck | null>(null);
  const [targets, setTargets] = useState<{ probe: RelayProbe; relay: RelayClient } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The relays checked are the relays the member list would be published to,
  // and the repair publishes only there (review of !227). Planned from the
  // owner-only 39002 itself, so NDK's routing for exactly that event decides.
  useEffect(() => {
    if (!isConnected || !pubkey || !service) return;
    let cancelled = false;
    const template = creationMembersTemplate(groupId, pubkey);
    void service
      .publishRelayUrls({ ...template, pubkey })
      .then((urls) => {
        const pinned = pinRelays(service, urls);
        if (!cancelled) setTargets(pinned);
        return checkProjectSetup(pubkey, pinned.probe, groupId);
      })
      .catch((): ProjectSetupCheck => ({ status: 'unchecked' }))
      .then((result) => {
        if (!cancelled) setCheck(result);
      });
    return () => {
      cancelled = true;
    };
  }, [isConnected, pubkey, service, groupId]);

  const finish = useCallback(async () => {
    if (!signer || !targets) {
      setError('Not connected');
      return;
    }
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await finishProjectSetup(signer, targets.relay, targets.probe, groupId);
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
  }, [signer, targets, groupId]);

  return { check, finish, isBusy, error, notice };
}
