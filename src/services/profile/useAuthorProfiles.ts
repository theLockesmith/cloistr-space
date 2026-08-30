/**
 * @fileoverview Fetch kind:0 metadata for the authors currently on screen.
 *
 * Space read `note.authorProfile?.picture` in three places -- the social feed,
 * group chat, and activity mentions -- and nothing ever assigned it. The field
 * is optional in all three type declarations, so TypeScript never objected, and
 * every surface silently fell back to a truncated pubkey. It was not a broken
 * fetch; there was no fetch.
 *
 * One subscription for all authors rather than one per author. A feed of fifty
 * notes from thirty people is one filter with thirty entries in `authors`, not
 * thirty subscriptions -- and under the outbox model each subscription fans out
 * across that author's relays, so the per-author version multiplies rather than
 * adds.
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { useNdk, subscribeStream, type NDKEvent } from '@/services/nostr';
import { METADATA_KIND, parseProfileContent } from './profileEvents';

export interface AuthorProfile {
  name?: string;
  displayName?: string;
  picture?: string;
  nip05?: string;
  about?: string;
}

/** Profiles keyed by pubkey. Missing keys simply have not resolved. */
export type AuthorProfiles = Map<string, AuthorProfile>;

/**
 * Resolve display metadata for a set of authors.
 *
 * Accumulates across calls rather than resetting per render: scrolling a feed
 * changes the author set constantly, and dropping a profile because its author
 * left the current page would make avatars flicker out on scroll.
 */
export function useAuthorProfiles(pubkeys: string[]): AuthorProfiles {
  const { subscribe, isConnected } = useNdk();
  const [profiles, setProfiles] = useState<AuthorProfiles>(new Map());

  const cacheRef = useRef<AuthorProfiles>(new Map());
  const requestedRef = useRef<Set<string>>(new Set());

  // Only authors we have not already asked about. Without this the effect
  // re-subscribes on every render where the author list changes at all, which
  // for an infinite-scroll feed is continuously.
  const unresolved = useMemo(() => {
    const out: string[] = [];
    for (const pubkey of pubkeys) {
      if (pubkey && !requestedRef.current.has(pubkey)) out.push(pubkey);
    }
    return out;
  }, [pubkeys]);

  // Stable key so the effect fires on CONTENT change, not array identity.
  const unresolvedKey = unresolved.join(',');

  useEffect(() => {
    if (!subscribe || !isConnected || unresolved.length === 0) return;

    for (const pubkey of unresolved) {
      requestedRef.current.add(pubkey);
    }

    const filter: NDKFilter = {
      kinds: [METADATA_KIND],
      authors: unresolved,
    };

    // Historical content: a kind:0 exists already or it does not. The opening
    // burst is the answer, so handlers are registered at subscribe time.
    //
    // Left open rather than closeOnEose because kind:0 is replaceable -- if
    // someone updates their picture while the feed is on screen, the new event
    // arrives on this same subscription and the avatar updates in place.
    const sub = subscribeStream(subscribe, [filter], {
      onEvent: (event: NDKEvent) => {
        const fields = parseProfileContent(event.content ?? '');

        const existing = cacheRef.current.get(event.pubkey);
        const next: AuthorProfile = {
          name: fields.name,
          // NIP-01 spells it display_name; the UI reads displayName.
          displayName: fields.display_name,
          picture: fields.picture,
          nip05: fields.nip05,
          about: fields.about,
        };

        // Skip the state update when nothing actually changed -- relays
        // commonly return the same replaceable event more than once, and each
        // one would otherwise re-render every card in the feed.
        if (
          existing &&
          existing.name === next.name &&
          existing.displayName === next.displayName &&
          existing.picture === next.picture &&
          existing.nip05 === next.nip05
        ) {
          return;
        }

        cacheRef.current.set(event.pubkey, next);
        setProfiles(new Map(cacheRef.current));
      },
    });

    return () => sub.stop();
    // unresolvedKey is the content-identity of `unresolved`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, isConnected, unresolvedKey]);

  return profiles;
}
