/**
 * @fileoverview Group members hook
 * Fetches members and admins of a NIP-29 group
 */

import { useState, useEffect, useCallback } from 'react';
import { useNdk } from '@/services/nostr';
import {
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  type AdminPermission,
} from '@/types/groups';

export interface GroupMember {
  pubkey: string;
  isAdmin: boolean;
  permissions: AdminPermission[];
  profile?: {
    name?: string;
    displayName?: string;
    picture?: string;
    about?: string;
    nip05?: string;
  };
}

interface UseGroupMembersReturn {
  members: GroupMember[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Hook for fetching members of a group
 */
export function useGroupMembers(groupId: string): UseGroupMembersReturn {
  const { fetchEvents, isConnected } = useNdk();
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setMembers([]);
    setIsLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!fetchEvents || !isConnected || !groupId) return;

    // Capture for closure
    const doFetch = fetchEvents;
    let cancelled = false;

    async function loadMembers() {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch both admin list (39001) and member list (39002)
        const events = await doFetch({
          kinds: [GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND],
          '#d': [groupId],
        });

        if (cancelled) return;

        const memberMap = new Map<string, GroupMember>();

        // Process events - latest events win (addressable events)
        const sortedEvents = Array.from(events).sort(
          (a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)
        );

        for (const event of sortedEvents) {
          if (event.kind === GROUP_MEMBERS_KIND) {
            // Member list (kind:39002) - p tags are members
            for (const tag of event.tags) {
              if (tag[0] !== 'p') continue;
              const pubkey = tag[1];
              if (!pubkey) continue;

              if (!memberMap.has(pubkey)) {
                memberMap.set(pubkey, {
                  pubkey,
                  isAdmin: false,
                  permissions: [],
                });
              }
            }
          } else if (event.kind === GROUP_ADMINS_KIND) {
            // Admin list (kind:39001) - p tags with permissions
            for (const tag of event.tags) {
              if (tag[0] !== 'p') continue;
              const pubkey = tag[1];
              if (!pubkey) continue;

              // Permissions are in tag[2], tag[3], etc.
              const permissions = tag.slice(2) as AdminPermission[];

              const existing = memberMap.get(pubkey);
              if (existing) {
                existing.isAdmin = true;
                existing.permissions = permissions;
              } else {
                memberMap.set(pubkey, {
                  pubkey,
                  isAdmin: true,
                  permissions,
                });
              }
            }
          }
        }

        // Convert to array, admins first
        const memberList = Array.from(memberMap.values()).sort((a, b) => {
          if (a.isAdmin && !b.isAdmin) return -1;
          if (!a.isAdmin && b.isAdmin) return 1;
          return 0;
        });

        setMembers(memberList);

        // TODO: Fetch profiles for members
        // This would require additional fetches for kind:0 events
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch members');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadMembers();

    return () => {
      cancelled = true;
    };
  }, [fetchEvents, isConnected, groupId, refreshKey]);

  return {
    members,
    isLoading,
    error,
    refresh,
  };
}
