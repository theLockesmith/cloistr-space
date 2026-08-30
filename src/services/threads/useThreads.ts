/**
 * @fileoverview Group threads (NIP-22 kind:1111) over NDK.
 *
 * Mirrors useGroupChat's subscription shape deliberately -- same relay filter
 * style, same event-map accumulation -- because Threads sits beside chat in the
 * same workspace and diverging would make the two behave differently for no
 * reason a user could perceive.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { useNdk, subscribeStream, type NDKEvent } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import {
  THREAD_KIND,
  buildThreadRootTags,
  buildReplyTags,
  parseThreadEvent,
  assembleThreads,
  type Thread,
  type ThreadComment,
  type ReplyTarget,
} from './threadEvents';

const MAX_COMMENTS = 500;

interface UseThreadsReturn {
  threads: Thread[];
  isLoading: boolean;
  error: string | null;
  createThread: (subject: string, body: string) => Promise<void>;
  reply: (target: ReplyTarget, content: string) => Promise<void>;
  refresh: () => void;
}

export function useThreads(groupId: string): UseThreadsReturn {
  const { subscribe, publish, createEvent, isConnected } = useNdk();
  const { pubkey } = useAuthStore();

  const [comments, setComments] = useState<ThreadComment[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const commentsRef = useRef<Map<string, ThreadComment>>(new Map());
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  const canSubscribe = Boolean(subscribe && isConnected && groupId);

  // Derived rather than set from inside the effect's guard. Writing
  // setIsLoading(false) there would be a synchronous setState during the effect
  // body, which cascades an extra render on every disconnect.
  const isLoading = canSubscribe && isFetching;

  // Extracted into a callback rather than written inline in the effect, which
  // is the same shape useGroupChat uses. The resets below are legitimate --
  // switching group has to clear the previous group's comments before the new
  // subscription starts filling them -- but they are synchronous setState, and
  // running them from a callback keeps that out of the effect body.
  const startSubscription = useCallback(() => {
    if (!canSubscribe || !subscribe) return;

    subscriptionRef.current?.unsubscribe();
    commentsRef.current.clear();
    setComments([]);
    setIsFetching(true);
    setError(null);

    // One filter for the whole group rather than one per thread: roots and
    // replies are the same kind and carry the same h tag, so the tree is
    // assembled client-side from a single subscription instead of N+1 round
    // trips as threads are opened.
    const filter: NDKFilter = {
      kinds: [THREAD_KIND as number],
      '#h': [groupId],
      limit: MAX_COMMENTS,
    };

    try {
      const subscription = subscribeStream(subscribe, [filter], {
        onEvent: (event: NDKEvent) => {
        const parsed = parseThreadEvent(
          {
            id: event.id,
            pubkey: event.pubkey,
            content: event.content,
            created_at: event.created_at,
            tags: event.tags,
          },
          groupId
        );
        if (!parsed) return;

        commentsRef.current.set(parsed.id, parsed);
        setComments(Array.from(commentsRef.current.values()));
        setIsFetching(false);
      },
        onEose: () => setIsFetching(false),
      }, { closeOnEose: false });



      subscriptionRef.current = { unsubscribe: () => subscription.stop() };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load threads');
      setIsFetching(false);
    }
  }, [canSubscribe, subscribe, groupId]);

  useEffect(() => {
    // Deferred to a macrotask so the state resets inside startSubscription do
    // not run synchronously in the effect body. Same approach as useGroupChat,
    // for the same reason.
    const timeoutId = setTimeout(() => startSubscription(), 0);

    return () => {
      clearTimeout(timeoutId);
      subscriptionRef.current?.unsubscribe();
    };
    // refreshKey is a deliberate re-run trigger, not a value the callback reads.
  }, [startSubscription, refreshKey]);

  // Assemble on read rather than storing the tree. Events arrive in arbitrary
  // order and a late-arriving root has to re-parent replies already held, which
  // an incrementally-maintained tree would get wrong.
  const threads = useMemo(() => assembleThreads(comments), [comments]);

  const createThread = useCallback(
    async (subject: string, body: string) => {
      if (!publish || !createEvent || !isConnected || !pubkey) {
        throw new Error('Not connected');
      }
      if (!subject.trim() && !body.trim()) {
        throw new Error('A thread needs a subject or a body');
      }

      const event = createEvent();
      if (!event) throw new Error('Could not create event');

      event.kind = THREAD_KIND;
      event.content = body.trim();
      event.tags = buildThreadRootTags(groupId, subject);

      await publish(event);
    },
    [publish, createEvent, isConnected, pubkey, groupId]
  );

  const reply = useCallback(
    async (target: ReplyTarget, content: string) => {
      if (!publish || !createEvent || !isConnected || !pubkey) {
        throw new Error('Not connected');
      }
      if (!content.trim()) {
        throw new Error('Reply cannot be empty');
      }

      const event = createEvent();
      if (!event) throw new Error('Could not create event');

      event.kind = THREAD_KIND;
      event.content = content.trim();
      event.tags = buildReplyTags(groupId, target);

      await publish(event);
    },
    [publish, createEvent, isConnected, pubkey, groupId]
  );

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { threads, isLoading, error, createThread, reply, refresh };
}
