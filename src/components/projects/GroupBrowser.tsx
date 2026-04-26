/**
 * @fileoverview Group browser component
 * Browse and join public NIP-29 groups
 */

import { useState, useCallback, useEffect } from 'react';
import { useNdk } from '@/services/nostr';
import { useGroupActions } from '@/services/groups/useGroupActions';
import { GROUP_METADATA_KIND, type Group } from '@/types/groups';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

interface GroupBrowserProps {
  onJoinGroup?: (groupId: string) => void;
  onClose?: () => void;
}

export function GroupBrowser({ onJoinGroup, onClose }: GroupBrowserProps) {
  const { fetchEvents, isConnected } = useNdk();
  const { joinGroup, canAct } = useGroupActions();
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch public groups
  useEffect(() => {
    if (!fetchEvents || !isConnected) return;

    // Capture reference for TypeScript narrowing
    const doFetch = fetchEvents;
    let cancelled = false;

    async function loadGroups() {
      setIsLoading(true);
      setError(null);

      try {
        const events = await doFetch({
          kinds: [GROUP_METADATA_KIND],
          limit: 100,
        });

        if (cancelled) return;

        const publicGroups: Group[] = [];

        events.forEach((event: NDKEvent) => {
          const identifier = event.tags.find((t) => t[0] === 'd')?.[1];
          const name = event.tags.find((t) => t[0] === 'name')?.[1];
          const isPublic = event.tags.some((t) => t[0] === 'public');

          if (!identifier || !name || !isPublic) return;

          publicGroups.push({
            id: event.id ?? '',
            pubkey: event.pubkey,
            identifier,
            name,
            description: event.tags.find((t) => t[0] === 'about')?.[1] || event.content || undefined,
            picture: event.tags.find((t) => t[0] === 'picture')?.[1],
            isPublic: true,
            isOpen: event.tags.some((t) => t[0] === 'open'),
            relay: event.relay?.url || '',
            createdAt: event.created_at ?? 0,
          });
        });

        // Sort by creation date, newest first
        publicGroups.sort((a, b) => b.createdAt - a.createdAt);
        setGroups(publicGroups);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load groups');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadGroups();

    return () => {
      cancelled = true;
    };
  }, [fetchEvents, isConnected]);

  const handleJoin = useCallback(async (group: Group) => {
    if (!canAct || joiningId) return;

    setJoiningId(group.identifier);
    try {
      await joinGroup(group.identifier);
      onJoinGroup?.(group.identifier);
    } catch (err) {
      console.error('Failed to join group:', err);
    } finally {
      setJoiningId(null);
    }
  }, [canAct, joiningId, joinGroup, onJoinGroup]);

  const filteredGroups = groups.filter((group) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      group.name.toLowerCase().includes(query) ||
      group.description?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cloistr-light/10 px-4 py-3">
        <h2 className="font-semibold text-cloistr-light">Browse Groups</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Search */}
      <div className="border-b border-cloistr-light/10 p-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search groups..."
          className="w-full rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light placeholder:text-cloistr-light/40 focus:border-cloistr-primary/50 focus:outline-none"
        />
      </div>

      {/* Groups list */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-start gap-3 rounded-lg border border-cloistr-light/10 p-4">
                <div className="h-12 w-12 rounded-lg bg-cloistr-light/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 rounded bg-cloistr-light/10" />
                  <div className="h-3 w-2/3 rounded bg-cloistr-light/10" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-cloistr-light/60">
                {searchQuery ? 'No groups match your search' : 'No public groups found'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredGroups.map((group) => (
              <div
                key={group.identifier}
                className="flex items-start gap-3 rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4"
              >
                {group.picture ? (
                  <img
                    src={group.picture}
                    alt=""
                    className="h-12 w-12 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-cloistr-primary/10 text-cloistr-primary">
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-cloistr-light truncate">{group.name}</h3>
                    {group.isOpen && (
                      <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-xs text-green-400">
                        Open
                      </span>
                    )}
                  </div>
                  {group.description && (
                    <p className="mt-1 text-sm text-cloistr-light/60 line-clamp-2">
                      {group.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleJoin(group)}
                  disabled={!canAct || joiningId === group.identifier}
                  className="shrink-0 rounded-lg bg-cloistr-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-cloistr-primary/90 disabled:opacity-50"
                >
                  {joiningId === group.identifier ? 'Joining...' : group.isOpen ? 'Join' : 'Request'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
