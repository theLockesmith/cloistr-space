/**
 * @fileoverview Group chat hook using NDK subscriptions
 * Subscribes to kind:9 messages for a specific group
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { useNdk, type NDKEvent } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { GroupMessage } from '@/types/groups';
import { GROUP_CHAT_KIND } from '@/types/groups';

/** Maximum messages to keep in memory */
const MAX_MESSAGES = 100;

/** Parse a kind:9 event into GroupMessage */
function parseMessageEvent(event: NDKEvent, groupId: string): GroupMessage | null {
  const tags = event.tags;

  // Verify this message is for the correct group
  const hTag = tags.find((t) => t[0] === 'h');
  if (!hTag || hTag[1] !== groupId) return null;

  // Reply to (e tag)
  const replyTag = tags.find((t) => t[0] === 'e');
  const replyTo = replyTag?.[1];

  // Mentioned pubkeys (p tags)
  const mentions = tags.filter((t) => t[0] === 'p').map((t) => t[1]);

  return {
    id: event.id,
    pubkey: event.pubkey,
    groupId,
    content: event.content,
    replyTo,
    mentions,
    createdAt: event.created_at || Math.floor(Date.now() / 1000),
  };
}

interface UseGroupChatOptions {
  /** Maximum messages to fetch */
  limit?: number;
  /** Auto-subscribe on mount */
  autoSubscribe?: boolean;
}

interface UseGroupChatReturn {
  messages: GroupMessage[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string, replyTo?: string) => Promise<void>;
  refresh: () => void;
}

/**
 * Hook for group chat messages
 * Returns messages sorted by time (oldest first for chat display)
 */
export function useGroupChat(groupId: string, options: UseGroupChatOptions = {}): UseGroupChatReturn {
  const { limit = MAX_MESSAGES, autoSubscribe = true } = options;
  const { subscribe, publish, createEvent, isConnected } = useNdk();
  const { pubkey } = useAuthStore();

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const messagesMapRef = useRef<Map<string, GroupMessage>>(new Map());

  const startSubscription = useCallback(() => {
    if (!subscribe || !isConnected || !groupId) {
      setIsLoading(false);
      return;
    }

    // Clean up existing subscription
    subscriptionRef.current?.unsubscribe();
    messagesMapRef.current.clear();

    setIsLoading(true);
    setError(null);

    // Subscribe to group chat messages
    const filter: NDKFilter = {
      kinds: [GROUP_CHAT_KIND as number],
      '#h': [groupId],
      limit: limit * 2,
    };

    try {
      const subscription = subscribe([filter], { closeOnEose: false });

      subscription.on('event', (event: NDKEvent) => {
        const message = parseMessageEvent(event, groupId);
        if (!message) return;

        messagesMapRef.current.set(message.id, message);

        // Sort by time (oldest first) and limit
        const sortedMessages = Array.from(messagesMapRef.current.values())
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(-limit);

        setMessages(sortedMessages);
        setIsLoading(false);
      });

      subscription.on('eose', () => {
        setIsLoading(false);
      });

      subscription.start();

      subscriptionRef.current = {
        unsubscribe: () => subscription.stop(),
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch messages');
      setIsLoading(false);
    }
  }, [subscribe, isConnected, groupId, limit]);

  // Send a message to the group
  const sendMessage = useCallback(async (content: string, replyTo?: string) => {
    if (!publish || !createEvent || !isConnected || !pubkey) {
      throw new Error('Not connected');
    }

    if (!content.trim()) {
      throw new Error('Message cannot be empty');
    }

    const event = createEvent();
    if (!event) throw new Error('Failed to create event');

    event.kind = GROUP_CHAT_KIND;
    event.content = content.trim();

    // Build tags
    const tags: string[][] = [
      ['h', groupId],
    ];

    if (replyTo) {
      tags.push(['e', replyTo, '', 'reply']);
    }

    event.tags = tags;

    await publish(event);

    // Optimistically add message to local state
    const now = Math.floor(Date.now() / 1000);
    const tempId = 'temp-' + now.toString();
    const newMessage: GroupMessage = {
      id: event.id || tempId,
      pubkey,
      groupId,
      content: content.trim(),
      replyTo,
      mentions: [],
      createdAt: now,
    };

    messagesMapRef.current.set(newMessage.id, newMessage);
    setMessages(Array.from(messagesMapRef.current.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-limit));
  }, [publish, createEvent, isConnected, pubkey, groupId, limit]);

  // Auto-subscribe on mount
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (autoSubscribe && groupId) {
      timeoutId = setTimeout(() => {
        startSubscription();
      }, 0);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      subscriptionRef.current?.unsubscribe();
    };
  }, [autoSubscribe, groupId, startSubscription]);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    refresh: startSubscription,
  };
}
