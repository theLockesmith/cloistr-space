/**
 * @fileoverview Group files hook
 * Fetches and manages files shared with a NIP-29 group
 * Uses kind:1063 (NIP-94) with h-tag for group association
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';

const FILE_METADATA_KIND = 1063;

export interface GroupFile {
  id: string;
  pubkey: string;
  groupId: string;
  url: string;
  mimeType?: string;
  hash?: string;
  size?: number;
  name?: string;
  summary?: string;
  thumbnail?: string;
  createdAt: number;
}

interface UseGroupFilesReturn {
  files: GroupFile[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Parse a kind:1063 event with h-tag into GroupFile
 */
function parseGroupFile(event: NDKEvent): GroupFile | null {
  const groupId = event.tags.find((t) => t[0] === 'h')?.[1];
  const url = event.tags.find((t) => t[0] === 'url')?.[1];

  if (!groupId || !url) return null;

  return {
    id: event.id ?? '',
    pubkey: event.pubkey,
    groupId,
    url,
    mimeType: event.tags.find((t) => t[0] === 'm')?.[1],
    hash: event.tags.find((t) => t[0] === 'x')?.[1],
    size: parseInt(event.tags.find((t) => t[0] === 'size')?.[1] || '0', 10) || undefined,
    name: event.tags.find((t) => t[0] === 'name')?.[1] || event.content || undefined,
    summary: event.tags.find((t) => t[0] === 'summary')?.[1],
    thumbnail: event.tags.find((t) => t[0] === 'thumb')?.[1],
    createdAt: event.created_at ?? 0,
  };
}

/**
 * Hook for fetching files shared with a group
 */
export function useGroupFiles(groupId: string): UseGroupFilesReturn {
  const { subscribe, isConnected } = useNdk();
  const { pubkey } = useAuthStore();
  const [files, setFiles] = useState<GroupFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subscriptionRef = useRef<NDKSubscription | null>(null);
  const seenIdsRef = useRef(new Set<string>());
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    seenIdsRef.current.clear();
    setFiles([]);
    setIsLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  }, []);

  // Track whether we have the prerequisites
  const canSubscribe = Boolean(subscribe && isConnected && groupId);

  useEffect(() => {
    if (!canSubscribe || !subscribe) {
      return;
    }

    // Clear seen IDs for fresh subscription
    seenIdsRef.current.clear();

    try {
      // Subscribe to kind:1063 with h-tag for this group
      const sub = subscribe({
        kinds: [FILE_METADATA_KIND],
        '#h': [groupId],
        limit: 100,
      });

      if (!sub) {
        throw new Error('Failed to subscribe');
      }

      subscriptionRef.current = sub;

      sub.on('event', (event: NDKEvent) => {
        const id = event.id;
        if (!id || seenIdsRef.current.has(id)) return;
        seenIdsRef.current.add(id);

        const file = parseGroupFile(event);
        if (!file) return;

        setFiles((prev) => {
          // Check for duplicate
          if (prev.some((f) => f.id === file.id)) return prev;
          // Add and sort by creation date, newest first
          return [...prev, file].sort((a, b) => b.createdAt - a.createdAt);
        });
      });

      sub.on('eose', () => {
        setIsLoading(false);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch files');
      setIsLoading(false);
    }

    return () => {
      subscriptionRef.current?.stop();
      subscriptionRef.current = null;
    };
  }, [canSubscribe, subscribe, groupId, pubkey, refreshKey]);

  return {
    files,
    isLoading,
    error,
    refresh,
  };
}
