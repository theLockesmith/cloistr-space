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

  const createGroup = useCallback(
    async (options: CreateGroupOptions): Promise<string> => {
      if (!signer || !relay) throw new Error('Not connected');
      return createGroupPure(signer, relay, options);
    },
    [signer, relay],
  );

  return {
    joinGroup,
    leaveGroup,
    createGroup,
    canAct,
  };
}
