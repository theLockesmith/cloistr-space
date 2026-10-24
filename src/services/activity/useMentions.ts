/**
 * @fileoverview Mentions hook using NDK subscriptions
 * Subscribes to everything addressed to the user (notes, reactions, reposts,
 * zaps) on our relays and the user's declared read relays. See inboxRelays.ts.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { useNdk, subscribeStream, type NDKEvent } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { trackAnswers, useUnreachable, withReachability, NO_RELAY_ANSWERED } from './widgetReads';
import type { Mention, WidgetState } from '@/types/activity';
import {
  NOTIFICATION_KINDS,
  classifyNotification,
  showsContent,
} from './notificationKinds';
import { inboxRelayUrls } from './inboxRelays';

/** How long to wait for the user's relay list before asking our relays alone. */
export const RELAY_LIST_READ_TIMEOUT_MS = 8_000;

/**
 * How a read of the user's relay list went. `unknown` (failed or not yet
 * answered) is not an answer, and must never be kept as one.
 */
type RelayListRead = { status: 'found'; tags: string[][] } | { status: 'absent' } | { status: 'unknown' };

/**
 * Read the user's newest kind:10002. `initial` settles within
 * RELAY_LIST_READ_TIMEOUT_MS (as `unknown` if the relays are slow); `settled`
 * is the read's real outcome, however long it takes.
 */
export function readRelayList(
  fetchEvents: (filter: NDKFilter) => Promise<Set<NDKEvent>>,
  pubkey: string
): { initial: Promise<RelayListRead>; settled: Promise<RelayListRead> } {
  const settled: Promise<RelayListRead> = fetchEvents({ kinds: [10002], authors: [pubkey], limit: 5 }).then(
    (events) => {
      let newest: NDKEvent | null = null;
      for (const e of events) if (!newest || (e.created_at ?? 0) > (newest.created_at ?? 0)) newest = e;
      return newest ? { status: 'found', tags: newest.tags } : { status: 'absent' };
    },
    () => ({ status: 'unknown' })
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RelayListRead>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'unknown' }), RELAY_LIST_READ_TIMEOUT_MS);
  });
  const initial = Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
  return { initial, settled };
}

const tagsOf = (read: RelayListRead) => (read.status === 'found' ? read.tags : null);

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

  const type = classifyNotification(event.kind ?? NOTE_KIND, Boolean(rootEvent || replyTo));

  // Parse sats from bolt11 tag on zap receipts.
  // lnbc<amount><unit> where unit is empty=sat, m=msat/100, u=microsat, etc.
  let zapSats: number | undefined;
  if (type === 'zap') {
    const bolt11 = event.tags.find((t) => t[0] === 'bolt11')?.[1];
    if (bolt11) {
      const m = bolt11.match(/lnbc(\d+)([munp]?)/i);
      if (m) {
        let sats = parseInt(m[1], 10);
        const unit = m[2];
        if (unit === 'm') sats *= 100000;
        else if (unit === 'u') sats *= 100;
        else if (unit === 'n') sats /= 10;
        else if (unit === 'p') sats /= 10000;
        zapSats = Math.round(sats);
      }
    }
  }

  return {
    id: event.id,
    pubkey: event.pubkey,
    // A kind:6's content is a JSON dump of the reposted event and a kind:9735's
    // is a receipt. Rendering either as a message body shows a wall of JSON
    // where the reader expected a sentence.
    content: showsContent(type) ? event.content : '',
    kind: event.kind ?? NOTE_KIND,
    type,
    replyTo,
    rootEvent,
    zapSats,
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
  const { subscribe, isConnected, fetchEvents, service } = useNdk();
  const unreachable = useUnreachable(isConnected);
  const { pubkey, isAuthenticated } = useAuthStore();
  // The inbox relays, resolved once per key: marking a mention read restarts
  // the subscription, and that must not re-read the relay list each time.
  const inboxRef = useRef<{ pubkey: string; urls: Promise<string[]> } | null>(null);
  const runRef = useRef(0);
  // Bumped when a relay list that arrived late should reopen the subscription.
  const [inboxRetry, setInboxRetry] = useState(0);

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
      // Not connected is not "nothing here": stay loading, and useUnreachable
      // turns it into an error if the connection does not come.
      setState((prev) => ({ ...prev, isLoading: true }));
      return;
    }

    // Clean up existing subscription
    subscriptionRef.current?.unsubscribe();
    mentionsMapRef.current.clear();

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    const sinceTimestamp = Math.floor(Date.now() / 1000) - since;

    // Build filter for notes that mention the user
    const filter: NDKFilter = {
      // ALL the kinds that can be addressed to you, not just kind:1.
      //
      // This subscribed to notes alone, so "someone replied to you" worked and
      // "someone liked your post" appeared nowhere -- which is most of the
      // interaction people actually receive, and probably why the feature read
      // as missing entirely.
      kinds: NOTIFICATION_KINDS,
      '#p': [pubkey],
      since: sinceTimestamp,
      limit: limit * 2, // Fetch extra to filter out own notes
    };

    const run = ++runRef.current;
    if (!inboxRef.current || inboxRef.current.pubkey !== pubkey) {
      const own = service?.getOwnRelayUrls() ?? [];
      const forKey = pubkey;
      const read = fetchEvents
        ? readRelayList(fetchEvents, forKey)
        : { initial: Promise.resolve<RelayListRead>({ status: 'unknown' }), settled: Promise.resolve<RelayListRead>({ status: 'unknown' }) };
      const entry = { pubkey: forKey, urls: read.initial.then((r) => inboxRelayUrls(tagsOf(r), own)) };
      inboxRef.current = entry;
      // A slow or failed read is not an answer, so it is not kept. Once the
      // real answer arrives it replaces the stand-in and the subscription
      // reopens on the inbox relays; if the read failed outright, the next
      // start reads again.
      void read.initial.then((first) => {
        if (first.status !== 'unknown') return;
        void read.settled.then((late) => {
          if (inboxRef.current !== entry) return;
          if (late.status === 'unknown') {
            inboxRef.current = null;
            return;
          }
          inboxRef.current = { pubkey: forKey, urls: Promise.resolve(inboxRelayUrls(tagsOf(late), own)) };
          if (late.status === 'found') setInboxRetry((n) => n + 1);
        });
      });
    }

    void inboxRef.current.urls.then((urls) => {
      // A newer start (key change, mark-read, unmount) superseded this one.
      if (run !== runRef.current) return;
      try {
        const tracked = trackAnswers({
          onEvent: (event: NDKEvent) => {
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
        },
          onEose: () => {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            lastUpdated: Date.now(),
          }));
        },
        }, () =>
          // Nobody answered: an error, never "nothing here". Items that did arrive stay.
          setState((prev) => ({ ...prev, isLoading: false, error: prev.items.length ? prev.error : NO_RELAY_ANSWERED }))
        );
        const subscription = subscribeStream(subscribe, [filter], tracked.handlers, { closeOnEose: false, relaySet: service?.getRelaySetFor(urls) });




        subscriptionRef.current = {
          unsubscribe: () => {
          tracked.cancel();
          subscription.stop();
        },
        };
      } catch (err) {
        setState({
          items: [],
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to fetch mentions',
          lastUpdated: Date.now(),
        });
      }
    });
      // inboxRetry is a trigger: a relay list that arrived late reopens the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, isConnected, pubkey, limit, since, readIds, fetchEvents, service, inboxRetry]);

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
      // A relay-list read still in flight must not open a subscription later.
      // runRef is a counter, not a DOM ref; bumping its current value is the point.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      runRef.current++;
      subscriptionRef.current?.unsubscribe();
    };
  }, [autoSubscribe, isAuthenticated, isConnected, startSubscription]);

  // Compute unread count
  const unreadCount = state.items.filter((m) => !m.read).length;

  return {
    ...withReachability(state, unreachable),
    refresh: startSubscription,
    markAsRead,
    markAllAsRead,
    unreadCount,
  };
}
