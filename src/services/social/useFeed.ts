/**
 * @fileoverview Feed hook
 * Subscribes to kind:1 notes with various filter modes
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNdk, subscribeStream, useCoalesced } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { useContactsStore } from '@/stores/contactsStore';
import { saveSnapshot, loadSnapshot, shouldPersist } from './feedSnapshot';
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

/**
 * How long to let the note list settle before resubscribing to engagement.
 *
 * Long enough that a burst of arriving notes produces a handful of
 * resubscriptions rather than one per note; short enough that reaction counts
 * still appear promptly. useCoalesced absorbs rather than extends, so a
 * continuously streaming feed still updates every window instead of never.
 */
const ENGAGEMENT_SETTLE_MS = 500;

/** How many notes the engagement subscription tracks. */
const ENGAGEMENT_WINDOW = 50;

/**
 * The engagement id set for a feed, preserving array IDENTITY when the ids have
 * not actually changed.
 *
 * That identity is the whole point. The returned array is an effect dependency,
 * so a fresh array of equal contents re-runs the effect, stops the subscription
 * and opens a new one -- which is precisely the churn this exists to remove.
 * Returning `prev` unchanged is what makes a settle tick free when nothing
 * moved.
 */
export function nextEngagementIds(prev: string[], notes: { id: string }[]): string[] {
  const next = notes.slice(0, ENGAGEMENT_WINDOW).map((n) => n.id);
  const same = next.length === prev.length && next.every((id, i) => id === prev[i]);
  return same ? prev : next;
}

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
  /** Number of contacts the following/wot filters are built from. */
  followingCount: number;
  /**
   * Set the local reacted/reposted flag for a note.
   *
   * Exists so the UI can show an action immediately and take it back if the
   * publish is refused. Without it a reaction is invisible until a relay echoes
   * it back, which is indistinguishable from the button being broken -- and is
   * what it was.
   */
  markReacted: (noteId: string, reacted: boolean) => void;
  markReposted: (noteId: string, reposted: boolean) => void;
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
  // Notes the CURRENT USER has reacted to / reposted, as observed in the
  // engagement stream. userReacted used to be a hardcoded false with a TODO, so
  // the heart could never fill no matter what happened on the network.
  const ownReactionsRef = useRef(new Set<string>());
  const ownRepostsRef = useRef(new Set<string>());
  // Engagement events need their OWN seen-set. seenIdsRef guards the main feed
  // subscription only, and the engagement handler had no equivalent -- so the
  // same reaction arriving from eleven relays was counted eleven times. Hidden
  // until now because the subscription used to close at eose, before duplicates
  // could accumulate.
  const seenEngagementRef = useRef(new Set<string>());

  // Get following list for filter
  const following = useMemo(() => {
    return Array.from(contacts.values())
      .filter((c) => c.isFollowing)
      .map((c) => c.pubkey);
  }, [contacts]);

  // Fold accumulated engagement into the rendered notes.
  //
  // Reads only refs, so it needs no deps and stays stable -- which matters
  // because useCoalesced holds it and re-creating it every render would defeat
  // the coalescing.
  const applyEngagement = useCallback(() => {
    setNotes((prev) =>
      prev.map((note) => {
        const engagement = engagementRef.current.get(note.id);
        const reacted = ownReactionsRef.current.has(note.id);
        const reposted = ownRepostsRef.current.has(note.id);
        if (!engagement && !reacted && !reposted) return note;
        return {
          ...note,
          engagement: engagement ?? note.engagement,
          // Sticky: an optimistic flag set locally must not be cleared by an
          // engagement pass that has not seen the echo yet.
          userReacted: note.userReacted || reacted,
          userReposted: note.userReposted || reposted,
        };
      })
    );
  }, []);

  // One render per burst instead of one per event. Publishing a reaction brings
  // the echo back from every relay that accepted it, so without this the tap
  // itself triggered a full-feed re-render per relay and locked the UI.
  const scheduleEngagementRender = useCoalesced(applyEngagement);

  // Optimistic flags. Set immediately on tap and reverted if the publish is
  // refused, so an action is visible at once and a failure is visible too.
  const markReacted = useCallback((noteId: string, reacted: boolean) => {
    // Rebuild rather than mutate in place, so a revert removes exactly one id.
    ownReactionsRef.current = reacted
      ? new Set([...ownReactionsRef.current, noteId])
      : new Set([...ownReactionsRef.current].filter((id) => id !== noteId));

    setNotes((prev) =>
      prev.map((note) =>
        note.id === noteId
          ? {
              ...note,
              userReacted: reacted,
              engagement: {
                ...note.engagement,
                // Move the count with the flag so the number and the fill do
                // not disagree while the echo is in flight.
                reactions: Math.max(0, note.engagement.reactions + (reacted ? 1 : -1)),
              },
            }
          : note
      )
    );
  }, []);

  const markReposted = useCallback((noteId: string, reposted: boolean) => {
    ownRepostsRef.current = reposted
      ? new Set([...ownRepostsRef.current, noteId])
      : new Set([...ownRepostsRef.current].filter((id) => id !== noteId));

    setNotes((prev) =>
      prev.map((note) =>
        note.id === noteId
          ? {
              ...note,
              userReposted: reposted,
              engagement: {
                ...note.engagement,
                reposts: Math.max(0, note.engagement.reposts + (reposted ? 1 : -1)),
              },
            }
          : note
      )
    );
  }, []);

  const refresh = useCallback(() => {
    seenIdsRef.current.clear();
    engagementRef.current.clear();
    // Must clear alongside the others: a refreshed feed re-receives the same
    // engagement events, and a stale seen-set would drop every one of them,
    // leaving counts at zero after a manual refresh.
    seenEngagementRef.current.clear();
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

  // --- Reload survival -------------------------------------------------
  //
  // Reloading the page emptied the feed until relays answered again. The
  // obvious fix was an NDK cache adapter; both candidates bundle their own copy
  // of NDK, so this is a render snapshot instead. See feedSnapshot.ts for why,
  // and for what it deliberately does NOT do.

  // Which mode/account the notes currently on screen were fetched under.
  //
  // Switching filters used to leave `notes` in place and MERGE the new mode's
  // snapshot into them, so the union was then saved under the new mode's key
  // and grew with every switch. After visiting all three filters, every key
  // held the same union and all three rendered identically -- reported as
  // "only showing my content (except now it's across all 3 view filters)".
  //
  // A feed for a different filter is a different feed. Changing mode resets it.
  const notesOwnerRef = useRef<string | null>(null);

  useEffect(() => {
    const owner = `${mode}:${pubkey ?? 'anon'}`;
    if (notesOwnerRef.current === owner) return;
    notesOwnerRef.current = owner;

    // Everything keyed to the old feed goes with it. Leaving seenIdsRef
    // populated would silently drop notes the new filter legitimately wants,
    // because they were already seen under the previous one.
    seenIdsRef.current.clear();
    engagementRef.current.clear();
    seenEngagementRef.current.clear();
    oldestTimestampRef.current = Math.floor(Date.now() / 1000);

    // REPLACE, not merge. The previous version merged to guard against the live
    // subscription having already delivered notes -- but both effects run in
    // the same commit, before any relay event can arrive, so that race does not
    // exist. The defence against an impossible race created a real bug.
    setNotes(loadSnapshot(mode, pubkey));
  }, [mode, pubkey]);

  // Persist on the trailing edge. Serialising 50 notes on every engagement
  // event would put a JSON.stringify on the exact per-event path that locked
  // the feed up, which is not a trade worth making for a convenience.
  const schedulePersist = useCoalesced(() => {
    if (!shouldPersist(notesOwnerRef.current, `${mode}:${pubkey ?? 'anon'}`, notes.length)) return;
    saveSnapshot(notes, mode, pubkey);
  }, 1000);

  useEffect(() => {
    schedulePersist();
  }, [notes, schedulePersist]);

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
      const sub = subscribeStream(subscribe, filters, {
        onEvent: (event: NDKEvent) => {
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
      },
        onEose: () => {
        setIsLoading(false);
        // If we got fewer notes than requested, no more to load
        const currentCount = seenIdsRef.current.size;
        if (currentCount < pageSize) {
          setHasMore(false);
        }
      },
      }, { closeOnEose: true });

      subscriptionRef.current = sub;



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

  // The engagement subscription's id set, settled on a trailing edge.
  //
  // This used to be derived straight from `notes`, so the key changed EVERY
  // TIME A NOTE ARRIVED. It is a dependency of the engagement effect below, so
  // each new note ran that effect's cleanup -- sub.stop() -- and NDK closed the
  // REQ. During initial load, notes stream in one at a time, so the
  // subscription was torn down and rebuilt up to fifty times, four filters
  // each, every one cancelling its predecessor mid-query. The relay logged it:
  //
  //   failed to fetch events using query "... tagvalues && ARRAY[$2..$41] ..."
  //     : context canceled
  //
  // Forty tag values is the feed at forty notes.
  //
  // The churn was always there. It became EXPENSIVE when the engagement
  // subscription stopped closing at eose -- before that, a teardown usually hit
  // an already-finished subscription and cost nothing. Fixing the reaction
  // visibility bug is what exposed the cost of this one.
  const engagementNoteIdsKey = notes.slice(0, ENGAGEMENT_WINDOW).map((n) => n.id).join(',');
  const [engagementNoteIds, setEngagementNoteIds] = useState<string[]>([]);

  const settleEngagementIds = useCoalesced(() => {
    setEngagementNoteIds((prev) => nextEngagementIds(prev, notes));
  }, ENGAGEMENT_SETTLE_MS);

  useEffect(() => {
    settleEngagementIds();
  }, [engagementNoteIdsKey, settleEngagementIds]);

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

    const sub = subscribeStream(subscribe, engagementFilters, {
        onEvent: (event: NDKEvent) => {
      // Same event, many relays. Without this the count inflates by however
      // many relays hold it, and each copy triggers another render.
      if (!event.id || seenEngagementRef.current.has(event.id)) return;
      seenEngagementRef.current.add(event.id);

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
        // Whose reaction it is decides whether the heart fills. This is the
        // real answer to the TODO that used to sit here.
        if (pubkey && event.pubkey === pubkey) ownReactionsRef.current.add(targetId);
      } else if (event.kind === REPOST_KIND) {
        current.reposts++;
        if (pubkey && event.pubkey === pubkey) ownRepostsRef.current.add(targetId);
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
      scheduleEngagementRender();
    },
        onEose: applyEngagement,
      // NOT closeOnEose. This subscription used to close after the initial
      // fetch, so a reaction published thirty seconds later never arrived and
      // the count never moved. Combined with setNotes running only at eose,
      // nothing in the UI could change after the first render -- which is why
      // a working button looked broken.
      }, { closeOnEose: false });




    return () => {
      sub.stop();
    };
    // applyEngagement and scheduleEngagementRender are both stable, so listing
    // them costs no extra subscriptions.
  }, [subscribe, isConnected, engagementNoteIds, pubkey, applyEngagement, scheduleEngagementRender]);

  return {
    notes,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
    setMode,
    mode,
    /**
     * How many contacts the following/wot filters are built from.
     *
     * Exposed so the empty state can tell apart "we asked and there was
     * nothing" from "we never asked, because there were no authors to ask
     * about". Those render identically otherwise, and the second one is the
     * common case: Space's contact store is NIP-0A kind:33000, while almost
     * every other Nostr client writes kind:3. A user with a full follow list
     * elsewhere starts here with an empty one until they import it.
     */
    followingCount: following.length,
    markReacted,
    markReposted,
  };
}
