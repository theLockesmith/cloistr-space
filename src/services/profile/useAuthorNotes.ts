/**
 * @fileoverview One author's notes, for their profile page.
 *
 * Deliberately NOT useFeed. That hook carries feed modes, engagement
 * subscriptions, paging and a render snapshot, none of which a profile page
 * wants, and I have already caused one regression by adding to it. A profile
 * needs "this person's recent notes" and nothing else.
 *
 * Relay hints from an nevent/nprofile are accepted because a profile reached by
 * a shared link may belong to someone whose notes live nowhere we are connected
 * -- the hints are the only way to find them.
 */

import { useEffect, useRef, useState } from 'react';
import { useNdk, subscribeStream, useCoalesced } from '@/services/nostr';
import { NOTE_KIND, type Note } from '@/types/social';
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';

const PAGE_SIZE = 30;

interface UseAuthorNotesReturn {
  notes: Note[];
  isLoading: boolean;
}

/** Minimal note projection. Engagement is not fetched here; the feed does that. */
function toNote(event: NDKEvent): Note | null {
  if (!event.id || !event.pubkey) return null;

  return {
    id: event.id,
    pubkey: event.pubkey,
    content: event.content ?? '',
    createdAt: event.created_at ?? 0,
    mentions: event.tags.filter((t) => t[0] === 'p').map((t) => t[1]),
    hashtags: event.tags.filter((t) => t[0] === 't').map((t) => t[1]),
    media: [],
    engagement: { reactions: 0, reposts: 0, replies: 0, zapAmount: 0, zapCount: 0 },
    userReacted: false,
    userReposted: false,
    userZapped: false,
  };
}

/**
 * Notes stamped with the author they were fetched for.
 *
 * One object rather than separate pieces of state, for the same two reasons as
 * useEmojiSets: it keeps `isLoading` DERIVED instead of assigned in an effect
 * body (which cascades renders and the lint rule rightly objects to), and it
 * makes navigating between profiles self-correcting -- notes stamped with the
 * previous author simply are not current, so you cannot briefly see one
 * person's notes under another's name.
 */
interface AuthorNotesState {
  owner: string;
  notes: Note[];
  settled: boolean;
}

export function useAuthorNotes(pubkey: string | null): UseAuthorNotesReturn {
  const { subscribe, isConnected } = useNdk();
  const [state, setState] = useState<AuthorNotesState | null>(null);

  const bufferRef = useRef<Map<string, Note>>(new Map());
  const subRef = useRef<NDKSubscription | null>(null);
  const ownerRef = useRef<string | null>(null);

  // Same lesson as the feed: one setState per arriving event re-renders the
  // whole list per note. Collapse the burst.
  const flush = useCoalesced(() => {
    const owner = ownerRef.current;
    if (!owner) return;
    setState({
      owner,
      notes: Array.from(bufferRef.current.values()).sort((a, b) => b.createdAt - a.createdAt),
      settled: true,
    });
  }, 150);

  useEffect(() => {
    if (!subscribe || !isConnected || !pubkey) return;
    if (ownerRef.current === pubkey) return;

    ownerRef.current = pubkey;
    bufferRef.current = new Map();

    // Handlers at subscribe time. An author's back catalogue is historical --
    // it arrives in the opening burst and a late .on() loses all of it.
    subRef.current = subscribeStream(
      subscribe,
      [{ kinds: [NOTE_KIND], authors: [pubkey], limit: PAGE_SIZE }],
      {
        onEvent: (event: NDKEvent) => {
          const note = toNote(event);
          // Keyed by id, so the same note from eleven relays counts once.
          if (note) bufferRef.current.set(note.id, note);
          flush();
        },
        onEose: () => flush(),
      }
    );
  }, [subscribe, isConnected, pubkey, flush]);

  // Stopped only on unmount or a connection change -- never on a dependency
  // change, which would kill the subscription before its burst arrived.
  useEffect(() => {
    return () => {
      subRef.current?.stop();
      subRef.current = null;
      ownerRef.current = null;
    };
  }, [subscribe, isConnected]);

  const current = state && state.owner === pubkey ? state : null;

  return {
    notes: current?.notes ?? [],
    isLoading: Boolean(subscribe && isConnected && pubkey) && !current?.settled,
  };
}
