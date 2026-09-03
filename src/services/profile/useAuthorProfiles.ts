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
import type { NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
import { useNdk, subscribeStream, type NDKEvent } from '@/services/nostr';
import { METADATA_KIND, parseProfileContent } from './profileEvents';

export interface AuthorProfile {
  name?: string;
  displayName?: string;
  picture?: string;
  nip05?: string;
  lud16?: string;
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
  // Live subscriptions, kept out of the effect's cleanup on purpose. See below.
  const subsRef = useRef<NDKSubscription[]>([]);

  // Stable key so the effect fires on author-SET-content change, not array
  // identity -- an infinite-scroll feed hands us a new `pubkeys` array
  // reference on every render even when the underlying authors are unchanged.
  //
  // This does NOT filter against requestedRef (it used to, via a useMemo that
  // read requestedRef.current during render -- react-hooks/refs flagged that:
  // a ref mutated imperatively in an effect is not safe to read while
  // rendering, since React can render without committing). The filtering
  // against requestedRef now happens inside the effect below instead, which
  // runs outside render and was always where the actual dedup decision (and
  // the requestedRef.current.add() that records it) belonged.
  const pubkeysKey = useMemo(
    () => Array.from(new Set(pubkeys.filter(Boolean))).sort().join(','),
    [pubkeys]
  );

  useEffect(() => {
    if (!subscribe || !isConnected || pubkeysKey === '') return;

    // Only authors we have not already asked about. Without this the effect
    // would re-subscribe every time it runs, which for an infinite-scroll
    // feed is continuously.
    const unresolved = pubkeysKey
      .split(',')
      .filter((pubkey) => !requestedRef.current.has(pubkey));
    if (unresolved.length === 0) return;

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
          lud16: fields.lud16,
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
          existing.nip05 === next.nip05 &&
          existing.lud16 === next.lud16
        ) {
          return;
        }

        cacheRef.current.set(event.pubkey, next);
        setProfiles(new Map(cacheRef.current));
      },
    });

    // DELIBERATELY NO CLEANUP HERE. Returning () => sub.stop() looks correct
    // and destroys the feature.
    //
    // A previous version keyed this effect on the requested-filtered list
    // (not pubkeysKey), so a subscription landing even one profile called
    // setProfiles, which re-rendered, which recomputed that filtered list as
    // empty -- changing the dependency and making React run `() =>
    // sub.stop()` before a second kind:0 had arrived. Self-triggering, and
    // total rather than flaky: best case one profile resolved, in practice
    // none, and the feature looked as though it had never been wired at all.
    //
    // pubkeysKey depends only on the incoming `pubkeys` prop, not on
    // requestedRef, so setProfiles above no longer feeds back into this
    // effect's dependency at all -- there is nothing left for a landed
    // profile to retrigger. Subscriptions are instead collected and stopped
    // by the effect below.
    subsRef.current.push(sub);
  }, [subscribe, isConnected, pubkeysKey]);

  // Tear down on unmount, and on a connection change.
  //
  // A subscription bound to a previous connection will never deliver, so the
  // requested set is cleared alongside it -- otherwise those authors stay
  // marked as asked-about and are never queried again on the new connection,
  // which would turn a reconnect into permanently missing avatars.
  useEffect(() => {
    return () => {
      for (const sub of subsRef.current) {
        sub.stop();
      }
      subsRef.current = [];
      requestedRef.current = new Set();
    };
  }, [subscribe, isConnected]);

  return profiles;
}
