/**
 * @fileoverview Mentions hook using NDK subscriptions
 * Subscribes to kind:1 notes where user is p-tagged
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { useNdk, type NDKEvent } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { Mention, WidgetState } from '@/types/activity';

/** Kind 1 - Text note */
const NOTE_KIND = 1;

/** Maximum mentions to display */
const MAX_MENTIONS = 20;

/** Storage key for read status */
const READ_MENTIONS_KEY = 'cloistr-read-mentions';

/** Parse a kind:1 event into Mention */
function parseMentionEvent(event: NDKEvent, readIds: Set<string>): Mention {
  const tags = event.tags;

  // Reply to (e tag with "reply" marker, or last e tag)
  const replyTags = tags.filter((t) => t[0] === 'e');
  const replyTag = replyTags.find((t) => t[3] === 'reply') || replyTags[replyTags.length - 1];
  const replyTo = replyTag?.[1];

  // Root event (e tag with "root" marker, or first e tag)
  const rootTag = replyTags.find((t) => t[3] === 'root') || replyTags[0];
  const rootEvent = rootTag?.[1];

  return {
    id: event.id,
    pubkey: event.pubkey,
    content: event.content,
    replyTo,
    rootEvent,
    createdAt: event.created_at || Math.floor(Date.now() / 1000),
    read: readIds.has(event.id),
  };
}

interface UseMentionsOptions {
  /** Limit number of mentions */
  limit?: number;
  /** Time window in seconds (default: 7 days) */
  since?: number;
  /** Auto-subscribe on mount */
  autoSubscribe?: boolean;
}

interface UseMentionsReturn extends WidgetState<Mention> {
  refresh: () => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  unreadCount: number;
}

/**
 * Hook for subscribing to mentions
 * Returns mentions sorted by most recent first
 */
export function useMentions(options: UseMentionsOptions = {}): UseMentionsReturn {
  const {
    limit = MAX_MENTIONS,
    since = 7 * 24 * 60 * 60, // 7 days
    autoSubscribe = true,
  } = options;
  const { subscribe, isConnected } = useNdk();
  const { pubkey, isAuthenticated } = useAuthStore();

  // Track read status
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(READ_MENTIONS_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [state, setState] = useState<WidgetState<Mention>>({
    items: [],
    isLoading: true,
    error: null,
    lastUpdated: null,
  });

  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const mentionsMapRef = useRef<Map<string, Mention>>(new Map());

  // Persist read IDs
  useEffect(() => {
    try {
      // Only keep recent read IDs to prevent unbounded growth
      const recentReadIds = Array.from(readIds).slice(-1000);
      localStorage.setItem(READ_MENTIONS_KEY, JSON.stringify(recentReadIds));
    } catch {
      // Ignore storage errors
    }
  }, [readIds]);

  const startSubscription = useCallback(() => {
    if (!subscribe || !isConnected || !pubkey) {
      setState((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    // Clean up existing subscription
    subscriptionRef.current?.unsubscribe();
    mentionsMapRef.current.clear();

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    const sinceTimestamp = Math.floor(Date.now() / 1000) - since;

    // Build filter for notes that mention the user
    const filter: NDKFilter = {
      kinds: [NOTE_KIND as number],
      '#p': [pubkey],
      since: sinceTimestamp,
      limit: limit * 2, // Fetch extra to filter out own notes
    };

    try {
      const subscription = subscribe([filter], { closeOnEose: false });

      subscription.on('event', (event: NDKEvent) => {
        // Skip own notes
        if (event.pubkey === pubkey) return;

        const mention = parseMentionEvent(event, readIds);
        mentionsMapRef.current.set(mention.id, mention);

        // Sort by created_at descending and limit
        const sortedMentions = Array.from(mentionsMapRef.current.values())
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, limit);

        setState({
          items: sortedMentions,
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
        error: err instanceof Error ? err.message : 'Failed to fetch mentions',
        lastUpdated: Date.now(),
      });
    }
  }, [subscribe, isConnected, pubkey, limit, since, readIds]);

  // Mark single mention as read
  const markAsRead = useCallback((id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    // Update local state
    setState((prev) => ({
      ...prev,
      items: prev.items.map((m) => (m.id === id ? { ...m, read: true } : m)),
    }));
  }, []);

  // Mark all mentions as read
  const markAllAsRead = useCallback(() => {
    const allIds = new Set(readIds);
    state.items.forEach((m) => allIds.add(m.id));
    setReadIds(allIds);

    setState((prev) => ({
      ...prev,
      items: prev.items.map((m) => ({ ...m, read: true })),
    }));
  }, [readIds, state.items]);

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

  // Compute unread count
  const unreadCount = state.items.filter((m) => !m.read).length;

  return {
    ...state,
    refresh: startSubscription,
    markAsRead,
    markAllAsRead,
    unreadCount,
  };
}
