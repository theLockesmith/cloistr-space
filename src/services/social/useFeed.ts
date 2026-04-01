/**
 * @fileoverview Feed hook
 * Subscribes to kind:1 notes with various filter modes
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { useContactsStore } from '@/stores/contactsStore';
import {
  NOTE_KIND,
  REACTION_KIND,
  REPOST_KIND,
  ZAP_RECEIPT_KIND,
  type Note,
  type NoteEngagement,
  type FeedMode,
  type MediaAttachment,
} from '@/types/social';
import type { NDKEvent, NDKSubscription, NDKFilter } from '@nostr-dev-kit/ndk';

const DEFAULT_PAGE_SIZE = 20;

interface UseFeedOptions {
  mode?: FeedMode;
  pageSize?: number;
  hashtag?: string;
}

interface UseFeedReturn {
  notes: Note[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  setMode: (mode: FeedMode) => void;
  mode: FeedMode;
}

/** Parse a kind:1 event into a Note */
function parseNoteEvent(event: NDKEvent): Note {
  // Extract reply info from e tags
  let replyTo: string | undefined;
  let rootEvent: string | undefined;

  for (const tag of event.tags) {
    if (tag[0] === 'e') {
      const marker = tag[3];
      if (marker === 'reply') {
        replyTo = tag[1];
      } else if (marker === 'root') {
        rootEvent = tag[1];
      } else if (!marker && !replyTo) {
        // Legacy: first e tag without marker is reply target
        replyTo = tag[1];
      }
    }
  }

  // Extract mentions (p tags)
  const mentions = event.tags
    .filter((t) => t[0] === 'p')
    .map((t) => t[1]);

  // Extract hashtags (t tags)
  const hashtags = event.tags
    .filter((t) => t[0] === 't')
    .map((t) => t[1].toLowerCase());

  // Extract media from content and tags
  const media = extractMedia(event.content, event.tags);

  return {
    id: event.id ?? '',
    pubkey: event.pubkey,
    content: event.content,
    createdAt: event.created_at ?? 0,
    replyTo,
    rootEvent,
    mentions,
    hashtags,
    media,
    engagement: {
      reactions: 0,
      replies: 0,
      reposts: 0,
      zapAmount: 0,
      zapCount: 0,
    },
    userReacted: false,
    userReposted: false,
    userZapped: false,
  };
}

/** Extract media URLs from content and tags */
function extractMedia(content: string, tags: string[][]): MediaAttachment[] {
  const media: MediaAttachment[] = [];
  const seen = new Set<string>();

  // Check for imeta tags (NIP-94 inline)
  for (const tag of tags) {
    if (tag[0] === 'imeta') {
      const url = tag.find((t) => t.startsWith('url '))?.slice(4);
      const mimeType = tag.find((t) => t.startsWith('m '))?.slice(2);
      if (url && !seen.has(url)) {
        seen.add(url);
        media.push({ url, mimeType });
      }
    }
  }

  // Extract URLs from content
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+\.(jpg|jpeg|png|gif|webp|mp4|webm|mov)/gi;
  const matches = content.match(urlRegex) || [];

  for (const url of matches) {
    if (!seen.has(url)) {
      seen.add(url);
      const ext = url.split('.').pop()?.toLowerCase();
      const mimeType = ext?.match(/^(jpg|jpeg|png|gif|webp)$/)
        ? `image/${ext === 'jpg' ? 'jpeg' : ext}`
        : ext?.match(/^(mp4|webm|mov)$/)
          ? `video/${ext}`
          : undefined;
      media.push({ url, mimeType });
    }
  }

  return media;
}

/**
 * Hook for fetching social feed
 */
export function useFeed(options: UseFeedOptions = {}): UseFeedReturn {
  const { pageSize = DEFAULT_PAGE_SIZE, hashtag } = options;
  const { subscribe, isConnected } = useNdk();
  const { pubkey } = useAuthStore();
  const { contacts } = useContactsStore();

  const [mode, setMode] = useState<FeedMode>(options.mode ?? 'following');
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const subscriptionRef = useRef<NDKSubscription | null>(null);
  const seenIdsRef = useRef(new Set<string>());
  const oldestTimestampRef = useRef<number | null>(null);
  const engagementRef = useRef(new Map<string, NoteEngagement>());

  // Get following list for filter
  const following = useMemo(() => {
    return Array.from(contacts.values())
      .filter((c) => c.isFollowing)
      .map((c) => c.pubkey);
  }, [contacts]);

  const refresh = useCallback(() => {
    seenIdsRef.current.clear();
    engagementRef.current.clear();
    oldestTimestampRef.current = Math.floor(Date.now() / 1000);
    setNotes([]);
    setHasMore(true);
    setIsLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  }, []);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoading) return;

    // Trigger subscription with older until timestamp
    setRefreshKey((k) => k + 1);
  }, [hasMore, isLoading]);

  // Main subscription effect
  useEffect(() => {
    if (!subscribe || !isConnected) {
      return;
    }

    // Initialize timestamp on first run
    if (oldestTimestampRef.current === null) {
      oldestTimestampRef.current = Math.floor(Date.now() / 1000);
    }

    // Build filter based on mode
    const buildFilters = (): NDKFilter[] => {
      const baseFilter: NDKFilter = {
        kinds: [NOTE_KIND],
        limit: pageSize,
        until: oldestTimestampRef.current ?? undefined,
      };

      if (hashtag) {
        baseFilter['#t'] = [hashtag.toLowerCase()];
      }

      switch (mode) {
        case 'following':
          if (following.length === 0) {
            // No contacts, return empty
            return [];
          }
          return [{ ...baseFilter, authors: following }];

        case 'wot':
          // For now, WoT is same as following
          // TODO: Implement 2nd degree follows
          if (following.length === 0) {
            return [];
          }
          return [{ ...baseFilter, authors: following }];

        case 'global':
          return [baseFilter];

        default:
          return [baseFilter];
      }
    };

    const filters = buildFilters();

    if (filters.length === 0) {
      // Use setTimeout to avoid synchronous setState in effect
      const timer = setTimeout(() => {
        setIsLoading(false);
        setHasMore(false);
      }, 0);
      return () => clearTimeout(timer);
    }

    try {
      const sub = subscribe(filters, { closeOnEose: true });

      subscriptionRef.current = sub;

      sub.on('event', (event: NDKEvent) => {
        const id = event.id;
        if (!id || seenIdsRef.current.has(id)) return;
        seenIdsRef.current.add(id);

        const note = parseNoteEvent(event);

        // Track oldest timestamp for pagination
        if (oldestTimestampRef.current === null || note.createdAt < oldestTimestampRef.current) {
          oldestTimestampRef.current = note.createdAt;
        }

        setNotes((prev) => {
          // Insert in sorted order (newest first)
          const newNotes = [...prev, note].sort((a, b) => b.createdAt - a.createdAt);
          return newNotes;
        });
      });

      sub.on('eose', () => {
        setIsLoading(false);
        // If we got fewer notes than requested, no more to load
        const currentCount = seenIdsRef.current.size;
        if (currentCount < pageSize) {
          setHasMore(false);
        }
      });

      sub.start();
    } catch (err) {
      // Use setTimeout to avoid synchronous setState in effect
      setTimeout(() => {
        setError(err instanceof Error ? err.message : 'Failed to load feed');
        setIsLoading(false);
      }, 0);
    }

    return () => {
      subscriptionRef.current?.stop();
      subscriptionRef.current = null;
    };
  }, [subscribe, isConnected, mode, following, hashtag, pageSize, refreshKey]);

  // Stable note IDs for engagement tracking - memoize based on first 50 note IDs
  const engagementNoteIdsKey = notes.slice(0, 50).map((n) => n.id).join(',');
  const engagementNoteIds = useMemo(() => {
    return notes.slice(0, 50).map((n) => n.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementNoteIdsKey]);

  // Engagement subscription (reactions, reposts, zaps for visible notes)
  useEffect(() => {
    if (!subscribe || !isConnected || engagementNoteIds.length === 0) return;

    const noteIds = engagementNoteIds;

    const engagementFilters: NDKFilter[] = [
      { kinds: [REACTION_KIND], '#e': noteIds },
      { kinds: [REPOST_KIND], '#e': noteIds },
      { kinds: [ZAP_RECEIPT_KIND], '#e': noteIds },
      // Also get replies
      { kinds: [NOTE_KIND], '#e': noteIds },
    ];

    const sub = subscribe(engagementFilters, { closeOnEose: true });

    sub.on('event', (event: NDKEvent) => {
      const targetId = event.tags.find((t) => t[0] === 'e')?.[1];
      if (!targetId) return;

      const current = engagementRef.current.get(targetId) ?? {
        reactions: 0,
        replies: 0,
        reposts: 0,
        zapAmount: 0,
        zapCount: 0,
      };

      if (event.kind === REACTION_KIND) {
        current.reactions++;
      } else if (event.kind === REPOST_KIND) {
        current.reposts++;
      } else if (event.kind === ZAP_RECEIPT_KIND) {
        current.zapCount++;
        // Try to parse amount from bolt11 tag
        const bolt11 = event.tags.find((t) => t[0] === 'bolt11')?.[1];
        if (bolt11) {
          const amountMatch = bolt11.match(/lnbc(\d+)([munp]?)/i);
          if (amountMatch) {
            const [, num, unit] = amountMatch;
            let sats = parseInt(num, 10);
            if (unit === 'm') sats *= 100000;
            else if (unit === 'u') sats *= 100;
            else if (unit === 'n') sats /= 10;
            else if (unit === 'p') sats /= 10000;
            current.zapAmount += sats;
          }
        }
      } else if (event.kind === NOTE_KIND) {
        current.replies++;
      }

      engagementRef.current.set(targetId, current);
    });

    sub.on('eose', () => {
      // Update notes with engagement data
      setNotes((prev) =>
        prev.map((note) => {
          const engagement = engagementRef.current.get(note.id);
          if (!engagement) return note;
          return {
            ...note,
            engagement,
            userReacted: false, // TODO: Check if current user reacted
            userReposted: false,
            userZapped: false,
          };
        })
      );
    });

    sub.start();

    return () => {
      sub.stop();
    };
  }, [subscribe, isConnected, engagementNoteIds, pubkey]);

  return {
    notes,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
    setMode,
    mode,
  };
}
