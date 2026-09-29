/**
 * @fileoverview Group actions hook
 * Join, leave, and create groups
 *
 * Delegates to groupService.ts for the actual event construction and
 * publishing. This hook provides the NDK-backed SignerInterface + RelayClient
 * adapter and the React-facing return shape.
 */

import { useCallback, useMemo } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { SignerInterface, RelayClient } from '../headless';
import type { Event, UnsignedEvent } from 'nostr-tools';
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

  const signer: SignerInterface | null = useMemo(() => {
    if (!pubkey) return null;
    return {
      getPublicKey: async () => pubkey,
      signEvent: async (unsigned: UnsignedEvent): Promise<Event> => {
        if (!createEvent || !publish) throw new Error('Not connected');
        const event = createEvent();
        if (!event) throw new Error('Failed to create event');
        event.kind = unsigned.kind;
        event.content = unsigned.content;
        event.tags = unsigned.tags;
        event.created_at = unsigned.created_at;
        await publish(event);
        return { ...unsigned, id: event.id || '0'.repeat(64), sig: event.sig || '0'.repeat(128) };
      },
      encrypt: async () => '',
      decrypt: async () => '',
    };
  }, [pubkey, createEvent, publish]);

  const relay: RelayClient = useMemo(() => ({
    publish: async () => 1,
    fetch: async () => [],
  }), []);

  const joinGroup = useCallback(
    async (groupId: string, message?: string) => {
      if (!signer) throw new Error('Not connected');
      await joinGroupPure(signer, relay, groupId, message);
    },
    [signer, relay],
  );

  const leaveGroup = useCallback(
    async (groupId: string) => {
      if (!signer) throw new Error('Not connected');
      await leaveGroupPure(signer, relay, groupId);
    },
    [signer, relay],
  );

  const createGroup = useCallback(
    async (options: CreateGroupOptions): Promise<string> => {
      if (!signer) throw new Error('Not connected');
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
