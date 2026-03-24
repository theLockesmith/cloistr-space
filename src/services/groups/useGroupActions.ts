/**
 * @fileoverview Group actions hook
 * Join, leave, and create groups
 */

import { useCallback } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import {
  GROUP_METADATA_KIND,
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  GROUP_JOIN_REQUEST_KIND,
  GROUP_LEAVE_REQUEST_KIND,
} from '@/types/groups';

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

interface CreateGroupOptions {
  /** Group name */
  name: string;
  /** Description */
  description?: string;
  /** Picture URL */
  picture?: string;
  /** Public (visible) vs private (hidden) */
  isPublic?: boolean;
  /** Open (anyone joins) vs closed (approval needed) */
  isOpen?: boolean;
}

/**
 * Hook for group management actions
 */
export function useGroupActions(): UseGroupActionsReturn {
  const { publish, createEvent, isConnected } = useNdk();
  const { pubkey, isAuthenticated } = useAuthStore();

  const canAct = Boolean(publish && isConnected && isAuthenticated && pubkey);

  // Request to join a group
  const joinGroup = useCallback(async (groupId: string, message?: string) => {
    if (!publish || !createEvent || !pubkey) {
      throw new Error('Not connected');
    }

    const event = createEvent();
    if (!event) throw new Error('Failed to create event');

    event.kind = GROUP_JOIN_REQUEST_KIND;
    event.content = message || '';
    event.tags = [
      ['h', groupId],
    ];

    await publish(event);
  }, [publish, createEvent, pubkey]);

  // Leave a group
  const leaveGroup = useCallback(async (groupId: string) => {
    if (!publish || !createEvent || !pubkey) {
      throw new Error('Not connected');
    }

    const event = createEvent();
    if (!event) throw new Error('Failed to create event');

    event.kind = GROUP_LEAVE_REQUEST_KIND;
    event.content = '';
    event.tags = [
      ['h', groupId],
    ];

    await publish(event);
  }, [publish, createEvent, pubkey]);

  // Create a new group
  const createGroup = useCallback(async (options: CreateGroupOptions): Promise<string> => {
    if (!publish || !createEvent || !pubkey) {
      throw new Error('Not connected');
    }

    const { name, description, picture, isPublic = true, isOpen = false } = options;

    // Generate unique group identifier
    const random = Math.random().toString(36).slice(2, 9);
    const identifier = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) + '-' + random;

    // Create group metadata event (kind:39000)
    const metadataEvent = createEvent();
    if (!metadataEvent) throw new Error('Failed to create event');

    metadataEvent.kind = GROUP_METADATA_KIND;
    metadataEvent.content = description || '';
    
    const metadataTags: string[][] = [
      ['d', identifier],
      ['name', name],
    ];
    
    if (description) metadataTags.push(['about', description]);
    if (picture) metadataTags.push(['picture', picture]);
    metadataTags.push([isPublic ? 'public' : 'private']);
    metadataTags.push([isOpen ? 'open' : 'closed']);

    metadataEvent.tags = metadataTags;

    await publish(metadataEvent);

    // Create admin list with creator as admin (kind:39001)
    const adminEvent = createEvent();
    if (!adminEvent) throw new Error('Failed to create event');

    adminEvent.kind = GROUP_ADMINS_KIND;
    adminEvent.content = '';
    adminEvent.tags = [
      ['d', identifier],
      ['p', pubkey, 'add-user', 'remove-user', 'edit-metadata', 'delete-event', 'add-permission', 'remove-permission'],
    ];

    await publish(adminEvent);

    // Create member list with creator as member (kind:39002)
    const memberEvent = createEvent();
    if (!memberEvent) throw new Error('Failed to create event');

    memberEvent.kind = GROUP_MEMBERS_KIND;
    memberEvent.content = '';
    memberEvent.tags = [
      ['d', identifier],
      ['p', pubkey],
    ];

    await publish(memberEvent);

    return identifier;
  }, [publish, createEvent, pubkey]);

  return {
    joinGroup,
    leaveGroup,
    createGroup,
    canAct,
  };
}
