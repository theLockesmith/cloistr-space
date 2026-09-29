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
 * whatever the member list component last rendered -- that list may be minutes
 * old, and publishing a stale full list would silently revert somebody else's
 * change.
 *
 * THE READS FILTER BY AUTHOR. Because a publish rewrites the whole list, a
 * read that swallowed an attacker's self-published kind:39002 would republish
 * it signed by the owner. That is the one path that turns a forgeable event
 * into a trusted one, so the author check belongs here even more than on the
 * display path. See trustedWriters.ts.
 *
 * Core logic lives in groupService.ts (React-free). This hook provides the
 * NDK-backed NostrClient adapter and React state management (isBusy, error,
 * notice).
 */

import { useCallback, useMemo, useState } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { AdminPermission } from '@/types/groups';
import type { NostrClient } from '../headless';
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
  const { fetchFromOwnRelays, createEvent, publish, isConnected } = useNdk();
  const { pubkey: myPubkey } = useAuthStore();

  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const client: NostrClient | null = useMemo(() => {
    if (!createEvent || !publish || !isConnected) return null;
    return {
      getPublicKey: async () => myPubkey ?? '',
      signAndPublish: async (template) => {
        const event = createEvent();
        if (!event) throw new Error('Failed to make event');
        event.kind = template.kind;
        event.content = template.content;
        event.tags = template.tags;
        const accepted = await publish(event);
        if (accepted.size === 0) throw new Error('No relay accepted the change.');
        return accepted.size;
      },
      publishSigned: async (raw) => {
        const event = createEvent();
        if (!event) throw new Error('Failed to make event');
        event.kind = raw.kind;
        event.content = raw.content;
        event.tags = raw.tags;
        event.created_at = raw.created_at;
        event.pubkey = raw.pubkey;
        event.id = raw.id;
        event.sig = raw.sig;
        const accepted = await publish(event);
        return accepted.size;
      },
      fetch: async (filter) => {
        if (!fetchFromOwnRelays) return [];
        const events = await fetchFromOwnRelays(filter as any);
        return Array.from(events) as any;
      },
    };
  }, [createEvent, publish, fetchFromOwnRelays, isConnected, myPubkey]);

  const addMember = useCallback(
    async (pubkey: string) => {
      if (!client) { setError('Not connected'); return; }
      setIsBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await addGroupMember(client, groupId, pubkey);
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
    [client, groupId],
  );

  const removeMember = useCallback(
    async (pubkey: string) => {
      if (!client) { setError('Not connected'); return; }
      setIsBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await removeGroupMember(client, groupId, pubkey);
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
    [client, groupId],
  );

  const setPermissions = useCallback(
    async (pubkey: string, permissions: AdminPermission[]) => {
      if (!client) { setError('Not connected'); return; }
      setIsBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await setGroupPermissionsPure(client, groupId, pubkey, permissions);
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
    [client, groupId],
  );

  const updateMetadata = useCallback(
    async (edit: GroupMetadataEdit) => {
      if (!client) { setError('Not connected'); return; }
      setIsBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await updateGroupMetadataPure(client, groupId, edit);
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
    [client, groupId],
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
