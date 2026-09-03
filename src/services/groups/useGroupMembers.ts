/**
 * @fileoverview Group members hook
 *
 * Fetches the members and admins of a group, accepting only events from
 * pubkeys entitled to write them. Before 2026-09-02 this hook queried by kind
 * and `#d` with no authors filter and merged whatever came back, so anyone
 * could publish their own kind:39002 and appear in any group. See
 * trustedWriters.ts for the anchor that makes filtering possible.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNdk } from '@/services/nostr';
import {
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  GROUP_METADATA_KIND,
  type AdminPermission,
} from '@/types/groups';
import { resolveTrustedWriters, authoritativeMembers } from './trustedWriters';

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
  /**
   * True when the group's identifier predates the pubkey-aware scheme, so no
   * owner can be derived and no author check is possible. The list shown is
   * whatever was published, by anyone. The UI must say so: presenting
   * forgeable data with no marking is the failure this flag exists to prevent.
   */
  unverifiable: boolean;
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
  const [unverifiable, setUnverifiable] = useState(false);
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
        // One query for all three kinds. Resolving the owner from a different
        // fetch than the one that produced the lists opens a window where they
        // disagree, and that window is exactly where an injection lands.
        const events = await doFetch({
          kinds: [GROUP_METADATA_KIND, GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND],
          '#d': [groupId],
        });

        if (cancelled) return;

        const all = Array.from(events);
        const writers = resolveTrustedWriters(groupId, all);
        const memberMap = new Map<string, GroupMember>();

        if (writers.status === 'resolved') {
          setUnverifiable(false);

          // authoritativeMembers returns [] for a group with no member event
          // and null only when unverifiable, which cannot happen here.
          for (const pubkey of authoritativeMembers(writers, all) ?? []) {
            memberMap.set(pubkey, { pubkey, isAdmin: false, permissions: [] });
          }

          for (const entry of writers.admins) {
            const existing = memberMap.get(entry.pubkey);
            if (existing) {
              existing.isAdmin = true;
              existing.permissions = entry.permissions;
            } else {
              memberMap.set(entry.pubkey, {
                pubkey: entry.pubkey,
                isAdmin: true,
                permissions: entry.permissions,
              });
            }
          }
        } else {
          // Legacy identifier: no owner prefix, so no author check exists. Show
          // what was published and mark it, rather than hiding the only groups
          // that currently exist or passing forgeable data off as verified.
          setUnverifiable(true);

          const sortedEvents = all.sort(
            (a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)
          );

          for (const event of sortedEvents) {
            if (event.kind === GROUP_MEMBERS_KIND) {
              for (const tag of event.tags) {
                if (tag[0] !== 'p' || !tag[1]) continue;
                if (!memberMap.has(tag[1])) {
                  memberMap.set(tag[1], { pubkey: tag[1], isAdmin: false, permissions: [] });
                }
              }
            } else if (event.kind === GROUP_ADMINS_KIND) {
              for (const tag of event.tags) {
                if (tag[0] !== 'p' || !tag[1]) continue;
                const permissions = tag.slice(2) as AdminPermission[];
                const existing = memberMap.get(tag[1]);
                if (existing) {
                  existing.isAdmin = true;
                  existing.permissions = permissions;
                } else {
                  memberMap.set(tag[1], { pubkey: tag[1], isAdmin: true, permissions });
                }
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
    unverifiable,
    refresh,
  };
}
