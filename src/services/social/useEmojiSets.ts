/**
 * @fileoverview Resolve the user's NIP-51 emoji, both hops.
 *
 * kind:10030 -> its `a` tags -> kind:30030 sets -> their `emoji` tags.
 *
 * Both hops are HISTORICAL in the sense subscribeOnce.ts describes: the whole
 * payload is the opening burst, so missing it loses everything permanently.
 * Handlers therefore go in at subscribe time, never attached afterwards.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNdk, subscribeOnce } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
import {
  EMOJI_LIST_KIND,
  EMOJI_SET_KIND,
  FALLBACK_EMOJI,
  mergeEmoji,
  parseEmojiTags,
  parseSetCoordinates,
  type EmojiEntry,
  type SetCoordinate,
} from './emojiSets';

interface Resolved {
  /** The pubkey these entries were fetched for. */
  owner: string;
  /** Entries tagged directly on the user's kind:10030. */
  direct: EmojiEntry[];
  /** Entries from the kind:30030 sets it referenced. */
  fromSets: EmojiEntry[];
  /** The first hop has answered; we are no longer waiting to show something. */
  settled: boolean;
}

interface UseEmojiSetsReturn {
  /** User entries first, then set entries, then the fallback. */
  emoji: EmojiEntry[];
  isLoading: boolean;
  /** True when the user actually has emoji of their own, beyond the fallback. */
  hasList: boolean;
}

export function useEmojiSets(): UseEmojiSetsReturn {
  const { subscribe, isConnected } = useNdk();
  const { pubkey } = useAuthStore();

  /**
   * Keyed by the pubkey it was resolved FOR.
   *
   * Two reasons it is one object rather than separate pieces of state. It keeps
   * loading derived instead of assigned in an effect body (which cascades
   * renders), and it makes an account switch self-correcting: entries stamped
   * with the previous owner are simply not current, so signing in as someone
   * else cannot show you their predecessor's emoji.
   */
  const [resolved, setResolved] = useState<Resolved | null>(null);

  const subsRef = useRef<NDKSubscription[]>([]);
  // kind:10030 is replaceable, so relays legitimately return different
  // versions. Keep the newest rather than whichever arrived last.
  const newestRef = useRef<number>(0);

  const fetchSets = useCallback(
    (coords: SetCoordinate[], owner: string) => {
      if (!subscribe || coords.length === 0) return;

      // One filter across every referenced set. The cross-product can return a
      // set we did not ask for (author A with author B's identifier), so
      // results are checked against the coordinates below rather than trusted.
      const wanted = new Set(coords.map((c) => `${c.pubkey}:${c.identifier}`));

      const sub = subscribeOnce(
        subscribe,
        [
          {
            kinds: [EMOJI_SET_KIND],
            authors: [...new Set(coords.map((c) => c.pubkey))],
            '#d': [...new Set(coords.map((c) => c.identifier))],
          },
        ],
        {
          onEvent: (event: NDKEvent) => {
            const d = event.tags.find((t) => t[0] === 'd')?.[1] ?? '';
            if (!wanted.has(`${event.pubkey}:${d}`)) return;

            const entries = parseEmojiTags(event.tags);
            if (entries.length === 0) return;

            // BUILD the state when it does not exist yet, rather than
            // returning prev and dropping the entries on the floor.
            //
            // fetchSets is kicked off from the kind:10030 handler, which calls
            // setResolved just before it -- but that is a React state update,
            // not an assignment. A kind:30030 arriving before it commits found
            // prev === null and the custom emoji were silently discarded. The
            // picker then showed only the fallback, which is indistinguishable
            // from a user who has no sets: "we got rid of the custom emoji
            // lists entirely".
            //
            // `owner` is captured per-fetch, so constructing here cannot
            // attribute one account's sets to another.
            setResolved((prev) =>
              prev && prev.owner !== owner
                ? prev
                : {
                    owner,
                    direct: prev?.direct ?? [],
                    fromSets: mergeEmoji(prev?.fromSets ?? [], entries),
                    settled: prev?.settled ?? false,
                  }
            );
          },
          onEose: () =>
            setResolved((prev) =>
              prev && prev.owner !== owner
                ? prev
                : {
                    owner,
                    direct: prev?.direct ?? [],
                    fromSets: prev?.fromSets ?? [],
                    settled: true,
                  }
            ),
        }
      );

      subsRef.current.push(sub);
    },
    [subscribe]
  );

  useEffect(() => {
    if (!subscribe || !isConnected || !pubkey) return;

    const owner = pubkey;

    const sub = subscribeOnce(
      subscribe,
      [{ kinds: [EMOJI_LIST_KIND], authors: [owner], limit: 1 }],
      {
        onEvent: (event: NDKEvent) => {
          if (event.created_at !== undefined && event.created_at < newestRef.current) return;
          newestRef.current = event.created_at ?? 0;

          const direct = parseEmojiTags(event.tags);
          setResolved((prev) => ({
            owner,
            direct,
            fromSets: prev && prev.owner === owner ? prev.fromSets : [],
            settled: prev?.owner === owner ? prev.settled : false,
          }));

          // The step that is easy to miss. A kind:10030 with no `emoji` tags is
          // not an empty list -- for most people who configured any, it is a
          // list of pointers, and stopping here reports "no emoji" to someone
          // who has plenty.
          const coords = parseSetCoordinates(event.tags);
          if (coords.length > 0) fetchSets(coords, owner);
        },
        onEose: () => {
          // Settles the first hop. If sets were referenced, fetchSets has its
          // own eose; marking settled here only means we are no longer waiting
          // on the list itself, which is the right moment to stop showing a
          // spinner over a usable fallback.
          setResolved((prev) =>
            prev && prev.owner === owner
              ? { ...prev, settled: true }
              : { owner, direct: [], fromSets: [], settled: true }
          );
        },
      }
    );

    subsRef.current.push(sub);
    // No cleanup here on purpose -- see useAuthorProfiles. Stopping on a
    // dependency change kills the subscription before its burst arrives.
  }, [subscribe, isConnected, pubkey, fetchSets]);

  useEffect(() => {
    return () => {
      for (const sub of subsRef.current) sub.stop();
      subsRef.current = [];
      newestRef.current = 0;
    };
  }, [subscribe, isConnected, pubkey]);

  // Only entries resolved for the CURRENT account count.
  const current = resolved && resolved.owner === pubkey ? resolved : null;

  // Fallback LAST so it can never shadow a shortcode the user defined.
  const emoji = mergeEmoji(current?.direct ?? [], current?.fromSets ?? [], FALLBACK_EMOJI);

  return {
    emoji,
    isLoading: Boolean(subscribe && isConnected && pubkey) && !current?.settled,
    hasList: (current?.direct.length ?? 0) > 0 || (current?.fromSets.length ?? 0) > 0,
  };
}
