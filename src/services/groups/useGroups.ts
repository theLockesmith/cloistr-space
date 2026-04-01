/**
 * @fileoverview Groups hook using NDK subscriptions
 * Subscribes to NIP-29 group events to list user's groups
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { useNdk, type NDKEvent } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { Group, GroupMembership, AdminPermission } from '@/types/groups';
import { GROUP_METADATA_KIND, GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND } from '@/types/groups';

/** Parse group metadata from kind:39000 event */
function parseGroupEvent(event: NDKEvent): Group | null {
  const tags = event.tags;

  // Required: d-tag identifier
  const dTag = tags.find((t) => t[0] === 'd');
  if (!dTag?.[1]) return null;

  // Name from 'name' tag
  const nameTag = tags.find((t) => t[0] === 'name');
  const name = nameTag?.[1] || dTag[1];

  // Description
  const descTag = tags.find((t) => t[0] === 'about' || t[0] === 'description');
  const description = descTag?.[1] || event.content || undefined;

  // Picture
  const pictureTag = tags.find((t) => t[0] === 'picture');
  const picture = pictureTag?.[1];

  // Public/private
  const publicTag = tags.find((t) => t[0] === 'public');
  const privateTag = tags.find((t) => t[0] === 'private');
  const isPublic = publicTag !== undefined || privateTag === undefined;

  // Open/closed
  const openTag = tags.find((t) => t[0] === 'open');
  const closedTag = tags.find((t) => t[0] === 'closed');
  const isOpen = openTag !== undefined || closedTag === undefined;

  // Relay
  const relayTag = tags.find((t) => t[0] === 'relay');
  const relay = relayTag?.[1] || '';

  return {
    id: event.id,
    pubkey: event.pubkey,
    identifier: dTag[1],
    name,
    description,
    picture,
    isPublic,
    isOpen,
    relay,
    createdAt: event.created_at || Math.floor(Date.now() / 1000),
  };
}

interface UseGroupsOptions {
  /** Auto-subscribe on mount */
  autoSubscribe?: boolean;
}

interface UseGroupsReturn {
  groups: GroupMembership[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Hook for listing user's groups
 * Returns groups where user is a member or admin
 */
export function useGroups(options: UseGroupsOptions = {}): UseGroupsReturn {
  const { autoSubscribe = true } = options;
  const { subscribe, isConnected } = useNdk();
  const { pubkey, isAuthenticated } = useAuthStore();

  const [groups, setGroups] = useState<GroupMembership[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  
  // Store raw data for processing
  const groupMetadataRef = useRef<Map<string, Group>>(new Map());
  const memberListsRef = useRef<Map<string, Set<string>>>(new Map());
  const adminListsRef = useRef<Map<string, Map<string, AdminPermission[]>>>(new Map());

  const processGroups = useCallback(() => {
    if (!pubkey) return;

    const memberships: GroupMembership[] = [];

    // Process each group the user is part of
    for (const [groupId, group] of groupMetadataRef.current) {
      const memberList = memberListsRef.current.get(groupId);
      const adminList = adminListsRef.current.get(groupId);

      const isMember = memberList?.has(pubkey) || false;
      const isAdmin = adminList?.has(pubkey) || false;
      const permissions = adminList?.get(pubkey) || [];

      // Only include if user is member or admin
      if (isMember || isAdmin) {
        memberships.push({
          group,
          isMember,
          isAdmin,
          permissions,
        });
      }
    }

    // Sort by name
    memberships.sort((a, b) => a.group.name.localeCompare(b.group.name));

    setGroups(memberships);
  }, [pubkey]);

  // Fetch group metadata by identifier
  const fetchGroupMetadata = useCallback((groupId: string) => {
    if (!subscribe || !isConnected) return;

    const filter: NDKFilter = {
      kinds: [GROUP_METADATA_KIND as number],
      '#d': [groupId],
      limit: 1,
    };

    const sub = subscribe([filter], { closeOnEose: true });

    sub.on('event', (event: NDKEvent) => {
      const group = parseGroupEvent(event);
      if (group) {
        groupMetadataRef.current.set(groupId, group);
        processGroups();
      }
    });

    sub.start();
  }, [subscribe, isConnected, processGroups]);

  const startSubscription = useCallback(() => {
    if (!subscribe || !isConnected || !pubkey) {
      setIsLoading(false);
      return;
    }

    // Clean up existing subscription
    subscriptionRef.current?.unsubscribe();
    groupMetadataRef.current.clear();
    memberListsRef.current.clear();
    adminListsRef.current.clear();

    setIsLoading(true);
    setError(null);

    // Subscribe to groups where user is tagged as member or admin
    const filters: NDKFilter[] = [
      // Member lists that include user
      {
        kinds: [GROUP_MEMBERS_KIND as number],
        '#p': [pubkey],
      },
      // Admin lists that include user
      {
        kinds: [GROUP_ADMINS_KIND as number],
        '#p': [pubkey],
      },
    ];

    try {
      const subscription = subscribe(filters, { closeOnEose: false });

      subscription.on('event', (event: NDKEvent) => {
        const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
        if (!dTag) return;

        if (event.kind === GROUP_MEMBERS_KIND) {
          // Track member lists
          if (!memberListsRef.current.has(dTag)) {
            memberListsRef.current.set(dTag, new Set());
          }
          // Add all members
          event.tags
            .filter((t) => t[0] === 'p')
            .forEach((t) => memberListsRef.current.get(dTag)?.add(t[1]));
        } else if (event.kind === GROUP_ADMINS_KIND) {
          // Track admin lists with permissions
          if (!adminListsRef.current.has(dTag)) {
            adminListsRef.current.set(dTag, new Map());
          }
          // Add admins with their permissions
          event.tags
            .filter((t) => t[0] === 'p')
            .forEach((t) => {
              const perms = t.slice(2) as AdminPermission[];
              adminListsRef.current.get(dTag)?.set(t[1], perms);
            });
        }

        // Now fetch group metadata for any new groups
        const groupIds = new Set([
          ...memberListsRef.current.keys(),
          ...adminListsRef.current.keys(),
        ]);

        // Fetch metadata for groups we don't have yet
        for (const gid of groupIds) {
          if (!groupMetadataRef.current.has(gid)) {
            fetchGroupMetadata(gid);
          }
        }

        processGroups();
      });

      subscription.on('eose', () => {
        setIsLoading(false);
      });

      subscription.start();

      subscriptionRef.current = {
        unsubscribe: () => subscription.stop(),
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch groups');
      setIsLoading(false);
    }
  }, [subscribe, isConnected, pubkey, processGroups, fetchGroupMetadata]);

  // Auto-subscribe on mount - use startSubscription directly but include it in deps
  // The subscription is idempotent (cleans up previous before starting new)
  useEffect(() => {
    if (!autoSubscribe || !isAuthenticated || !isConnected) {
      return;
    }

    const timeoutId = setTimeout(() => {
      startSubscription();
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      subscriptionRef.current?.unsubscribe();
    };
    // startSubscription is stable enough - only changes when subscribe/isConnected/pubkey change
    // which are already conditions we want to re-subscribe on
  }, [autoSubscribe, isAuthenticated, isConnected, startSubscription]);

  return {
    groups,
    isLoading,
    error,
    refresh: startSubscription,
  };
}
