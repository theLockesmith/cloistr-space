/**
 * @fileoverview Group actions hook
 * Join, leave, and create groups
 *
 * Delegates to groupService.ts for the actual event construction and
 * publishing. This hook provides the NDK-backed NostrClient adapter and
 * the React-facing return shape.
 */

import { useCallback, useMemo } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { NostrClient } from '../headless';
import {
  joinGroup as joinGroupPure,
  leaveGroup as leaveGroupPure,
  createGroup as createGroupPure,
  type CreateGroupOptions,
} from './groupService';

interface UseGroupActionsReturn {
  /** Request to join a group */
  joinGroup: (groupId: string, message?: string) => Promise<void>;
  /** Leave a group */
  leaveGroup: (groupId: string) => Promise<void>;
  /** Create a new group */
  createGroup: (options: CreateGroupOptions) => Promise<string>;
  /** Whether connected and authenticated */
  canAct: boolean;
}

/**
 * Hook for group management actions
 */
export function useGroupActions(): UseGroupActionsReturn {
  const { publish, createEvent, isConnected } = useNdk();
  const { pubkey, isAuthenticated } = useAuthStore();

  const canAct = Boolean(publish && isConnected && isAuthenticated && pubkey);

  const client: NostrClient | null = useMemo(() => {
    if (!publish || !createEvent || !pubkey) return null;
    return {
      getPublicKey: async () => pubkey,
      signAndPublish: async (template) => {
        const event = createEvent();
        if (!event) throw new Error('Failed to create event');
        event.kind = template.kind;
        event.content = template.content;
        event.tags = template.tags;
        const accepted = await publish(event);
        return accepted.size;
      },
      publishSigned: async (raw) => {
        const event = createEvent();
        if (!event) throw new Error('Failed to create event');
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
      fetch: async () => [],
    };
  }, [publish, createEvent, pubkey]);

  const joinGroup = useCallback(
    async (groupId: string, message?: string) => {
      if (!client) throw new Error('Not connected');
      await joinGroupPure(client, groupId, message);
    },
    [client],
  );

  const leaveGroup = useCallback(
    async (groupId: string) => {
      if (!client) throw new Error('Not connected');
      await leaveGroupPure(client, groupId);
    },
    [client],
  );

  const createGroup = useCallback(
    async (options: CreateGroupOptions): Promise<string> => {
      if (!client) throw new Error('Not connected');
      return createGroupPure(client, options);
    },
    [client],
  );

  return {
    joinGroup,
    leaveGroup,
    createGroup,
    canAct,
  };
}
