/**
 * @fileoverview Group actions hook
 * Join, leave, and create groups
 *
 * Delegates to groupService.ts for the actual event construction and
 * publishing. This hook supplies the NDK-backed adapters (useHeadlessAdapters)
 * and the React-facing return shape.
 */

import { useCallback } from 'react';
import { useNdk, useHeadlessAdapters } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import {
  joinGroup as joinGroupPure,
  leaveGroup as leaveGroupPure,
  createGroup as createGroupPure,
  beginGroupCreation as beginGroupCreationPure,
  type CreateGroupOptions,
  type PendingGroup,
} from './groupService';

interface UseGroupActionsReturn {
  /** Request to join a group */
  joinGroup: (groupId: string, message?: string) => Promise<void>;
  /** Leave a group */
  leaveGroup: (groupId: string) => Promise<void>;
  /** Mint a group identifier before publishing, so a failed create can be finished */
  beginGroupCreation: (name: string) => Promise<PendingGroup>;
  /** Create a new group, or finish `pending` if a previous attempt failed partway */
  createGroup: (options: CreateGroupOptions, pending?: PendingGroup) => Promise<string>;
  /** Whether connected and authenticated */
  canAct: boolean;
}

/**
 * Hook for group management actions
 */
export function useGroupActions(): UseGroupActionsReturn {
  const { publish, isConnected } = useNdk();
  const { pubkey, isAuthenticated } = useAuthStore();

  const canAct = Boolean(publish && isConnected && isAuthenticated && pubkey);

  const { signer, relay } = useHeadlessAdapters();

  const joinGroup = useCallback(
    async (groupId: string, message?: string) => {
      if (!signer || !relay) throw new Error('Not connected');
      await joinGroupPure(signer, relay, groupId, message);
    },
    [signer, relay],
  );

  const leaveGroup = useCallback(
    async (groupId: string) => {
      if (!signer || !relay) throw new Error('Not connected');
      await leaveGroupPure(signer, relay, groupId);
    },
    [signer, relay],
  );

  const beginGroupCreation = useCallback(
    async (name: string): Promise<PendingGroup> => {
      if (!signer) throw new Error('Not connected');
      return beginGroupCreationPure(signer, name);
    },
    [signer],
  );

  const createGroup = useCallback(
    async (options: CreateGroupOptions, pending?: PendingGroup): Promise<string> => {
      if (!signer || !relay) throw new Error('Not connected');
      return createGroupPure(signer, relay, options, pending);
    },
    [signer, relay],
  );

  return {
    joinGroup,
    leaveGroup,
    beginGroupCreation,
    createGroup,
    canAct,
  };
}
