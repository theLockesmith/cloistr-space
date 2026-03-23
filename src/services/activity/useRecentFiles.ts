/**
 * @fileoverview Recent files hook using NDK subscriptions
 * Subscribes to kind:1063 (NIP-94 file metadata) events
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { useNdk, type NDKEvent } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { FileMetadata, WidgetState } from '@/types/activity';

/** NIP-94 File Metadata kind */
const FILE_METADATA_KIND = 1063;

/** Maximum files to display */
const MAX_FILES = 10;

/** Parse a kind:1063 event into FileMetadata */
function parseFileEvent(event: NDKEvent): FileMetadata | null {
  const tags = event.tags;

  // Required: url tag
  const urlTag = tags.find((t) => t[0] === 'url');
  if (!urlTag?.[1]) return null;

  // Get filename from tag or infer from URL
  const nameTag = tags.find((t) => t[0] === 'name');
  const url = urlTag[1];
  const name = nameTag?.[1] || url.split('/').pop() || 'Unnamed file';

  // MIME type
  const mimeTag = tags.find((t) => t[0] === 'm' || t[0] === 'mime');
  const mimeType = mimeTag?.[1] || 'application/octet-stream';

  // Size
  const sizeTag = tags.find((t) => t[0] === 'size');
  const size = sizeTag?.[1] ? parseInt(sizeTag[1], 10) : undefined;

  // Hash
  const hashTag = tags.find((t) => t[0] === 'x');
  const hash = hashTag?.[1];

  // Thumbnail
  const thumbTag = tags.find((t) => t[0] === 'thumb');
  const thumbnail = thumbTag?.[1];

  // Dimensions
  const dimTag = tags.find((t) => t[0] === 'dim');
  let dimensions: FileMetadata['dimensions'];
  if (dimTag?.[1]) {
    const [w, h] = dimTag[1].split('x').map(Number);
    if (w && h) dimensions = { width: w, height: h };
  }

  // Blurhash
  const blurhashTag = tags.find((t) => t[0] === 'blurhash');
  const blurhash = blurhashTag?.[1];

  // Group association
  const groupTag = tags.find((t) => t[0] === 'h');
  const groupId = groupTag?.[1];

  return {
    id: event.id,
    pubkey: event.pubkey,
    name,
    url,
    mimeType,
    size,
    hash,
    thumbnail,
    dimensions,
    blurhash,
    groupId,
    createdAt: event.created_at || Math.floor(Date.now() / 1000),
  };
}

interface UseRecentFilesOptions {
  /** Limit number of files */
  limit?: number;
  /** Filter by group */
  groupId?: string;
  /** Auto-subscribe on mount */
  autoSubscribe?: boolean;
}

/**
 * Hook for subscribing to recent files
 * Returns files sorted by most recent first
 */
export function useRecentFiles(options: UseRecentFilesOptions = {}): WidgetState<FileMetadata> & {
  refresh: () => void;
} {
  const { limit = MAX_FILES, groupId, autoSubscribe = true } = options;
  const { subscribe, isConnected } = useNdk();
  const { pubkey, isAuthenticated } = useAuthStore();

  const [state, setState] = useState<WidgetState<FileMetadata>>({
    items: [],
    isLoading: true,
    error: null,
    lastUpdated: null,
  });

  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const filesMapRef = useRef<Map<string, FileMetadata>>(new Map());

  const startSubscription = useCallback(() => {
    if (!subscribe || !isConnected || !pubkey) {
      setState((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    // Clean up existing subscription
    subscriptionRef.current?.unsubscribe();
    filesMapRef.current.clear();

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    // Build filter for user's files
    const filter: NDKFilter = {
      kinds: [FILE_METADATA_KIND as number],
      authors: [pubkey],
      limit: limit * 2, // Fetch extra for deduplication
    };

    // Add group filter if specified
    if (groupId) {
      filter['#h'] = [groupId];
    }

    try {
      const subscription = subscribe([filter], { closeOnEose: false });

      subscription.on('event', (event: NDKEvent) => {
        const file = parseFileEvent(event);
        if (!file) return;

        filesMapRef.current.set(file.id, file);

        // Sort by created_at descending and limit
        const sortedFiles = Array.from(filesMapRef.current.values())
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, limit);

        setState({
          items: sortedFiles,
          isLoading: false,
          error: null,
          lastUpdated: Date.now(),
        });
      });

      subscription.on('eose', () => {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          lastUpdated: Date.now(),
        }));
      });

      subscription.start();

      subscriptionRef.current = {
        unsubscribe: () => subscription.stop(),
      };
    } catch (err) {
      setState({
        items: [],
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch files',
        lastUpdated: Date.now(),
      });
    }
  }, [subscribe, isConnected, pubkey, limit, groupId]);

  // Auto-subscribe on mount
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (autoSubscribe && isAuthenticated && isConnected) {
      // Defer to avoid sync setState in effect
      timeoutId = setTimeout(() => {
        startSubscription();
      }, 0);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      subscriptionRef.current?.unsubscribe();
    };
  }, [autoSubscribe, isAuthenticated, isConnected, startSubscription]);

  return {
    ...state,
    refresh: startSubscription,
  };
}
