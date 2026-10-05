/**
 * @fileoverview Add and remove members, and edit group metadata.
 *
 * CLIENT-AUTHORITATIVE, because our relay does not run relay29. Nothing
 * processes a kind:9000 here, so the key holder publishes kind:39002 directly
 * and it is a plain addressable event. See membershipEdits.ts for the full
 * reasoning and for the hazard that follows from it.
 *
 * Every mutation is READ, COMPUTE, PUBLISH-WHOLE, and a read that failed
 * produces no publish. The read is done fresh at edit time rather than reusing
 * whatever the member list component last rendered.
 *
 * THE READS FILTER BY AUTHOR. Because a publish rewrites the whole list, a
 * read that swallowed an attacker's self-published kind:39002 would republish
 * it signed by the owner. That is the one path that turns a forgeable event
 * into a trusted one, so the author check belongs here even more than on the
 * display path. See trustedWriters.ts.
 *
 * Core logic lives in groupService.ts (React-free, accepts SignerInterface +
 * RelayClient). This hook supplies the NDK-backed adapters and React state
 * management (isBusy, error, notice).
 */

import { useCallback, useState } from 'react';
import { useNdk, useHeadlessAdapters } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { AdminPermission } from '@/types/groups';
import { REFUSAL_MESSAGE } from './membershipEdits';
import {
  addGroupMember,
  removeGroupMember,
  setGroupPermissions as setGroupPermissionsPure,
  updateGroupMetadata as updateGroupMetadataPure,
} from './groupService';

export interface GroupMetadataEdit {
  name?: string;
  about?: string;
  picture?: string;
}

interface UseGroupAdminReturn {
  addMember: (pubkey: string) => Promise<void>;
  setPermissions: (pubkey: string, permissions: AdminPermission[]) => Promise<void>;
  removeMember: (pubkey: string) => Promise<void>;
  updateMetadata: (edit: GroupMetadataEdit) => Promise<void>;
  isBusy: boolean;
  error: string | null;
  notice: string | null;
  dismiss: () => void;
}

export function useGroupAdmin(groupId: string): UseGroupAdminReturn {
  const { isConnected } = useNdk();
  const { pubkey: myPubkey } = useAuthStore();

  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Gated on isConnected as before: these are read-then-write edits, and a
  // read against no relay must not be mistaken for an empty member list.
  const adapters = useHeadlessAdapters();
  const signer = isConnected && myPubkey ? adapters.signer : null;
  const relay = isConnected ? adapters.relay : null;

  const addMember = useCallback(
    async (pubkey: string) => {
      if (!signer || !relay) { setError('Not connected'); return; }
      setIsBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await addGroupMember(signer, relay, groupId, pubkey);
        if (!result.ok) {
          setNotice(REFUSAL_MESSAGE[result.reason]);
          return;
        }
        setNotice('Member added.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The change was not saved.');
      } finally {
        setIsBusy(false);
      }
    },
    [signer, relay, groupId],
  );

  const removeMember = useCallback(
    async (pubkey: string) => {
      if (!signer || !relay) { setError('Not connected'); return; }
      setIsBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await removeGroupMember(signer, relay, groupId, pubkey);
        if (!result.ok) {
          setNotice(REFUSAL_MESSAGE[result.reason]);
          return;
        }
        setNotice('Member removed.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The change was not saved.');
      } finally {
        setIsBusy(false);
      }
    },
    [signer, relay, groupId],
  );

  const setPermissions = useCallback(
    async (pubkey: string, permissions: AdminPermission[]) => {
      if (!signer || !relay) { setError('Not connected'); return; }
      setIsBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await setGroupPermissionsPure(signer, relay, groupId, pubkey, permissions);
        if (!result.ok) {
          setNotice(result.reason ?? 'Could not update permissions.');
          return;
        }
        setNotice('Permissions updated.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The change was not saved.');
      } finally {
        setIsBusy(false);
      }
    },
    [signer, relay, groupId],
  );

  const updateMetadata = useCallback(
    async (edit: GroupMetadataEdit) => {
      if (!signer || !relay) { setError('Not connected'); return; }
      setIsBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await updateGroupMetadataPure(signer, relay, groupId, edit);
        if (!result.ok) {
          setNotice(result.reason ?? 'Could not save.');
          return;
        }
        setNotice('Project details saved.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The change was not saved.');
      } finally {
        setIsBusy(false);
      }
    },
    [signer, relay, groupId],
  );

  return {
    addMember,
    removeMember,
    setPermissions,
    updateMetadata,
    isBusy,
    error,
    notice,
    dismiss: useCallback(() => {
      setError(null);
      setNotice(null);
    }, []),
  };
}
