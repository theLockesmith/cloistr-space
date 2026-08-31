/**
 * @fileoverview One note with its replies, reactions and zaps.
 *
 * Reads BOTH threading conventions and writes only NIP-10 -- see
 * replyEvents.ts for why the target's kind decides that, not our preference.
 *
 * Relay hints from the nevent are honoured. A note reached by a shared link
 * routinely lives somewhere we are not connected, and the hints are the only
 * thing that can find it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNdk, subscribeStream, useCoalesced } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { toNote } from './noteProjection';
import {
  COMMENT_KIND,
  assembleReplies,
  parseCommentTags,
  parseReplyTags,
  type ThreadNode,
} from './replyEvents';
import {
  NOTE_KIND,
  REACTION_KIND,
  REPOST_KIND,
  ZAP_RECEIPT_KIND,
  type Note,
} from '@/types/social';
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';

export interface ThreadReply extends Note {
  /** The event this answers, for assembling the tree. */
  replyTo?: string;
}

interface UseNoteThreadReturn {
  root: Note | null;
  replies: ThreadNode<ThreadReply>[];
  replyCount: number;
  isLoading: boolean;
  /** True once the root query settled without finding the note. */
  notFound: boolean;
}

interface ThreadState {
  owner: string;
  root: Note | null;
  replies: Map<string, ThreadReply>;
  settled: boolean;
}

export function useNoteThread(noteId: string | null, relayHints: string[] = []): UseNoteThreadReturn {
  const { subscribe, isConnected } = useNdk();
  const { pubkey } = useAuthStore();

  const [state, setState] = useState<ThreadState | null>(null);

  const rootRef = useRef<Note | null>(null);
  const repliesRef = useRef<Map<string, ThreadReply>>(new Map());
  const engagementRef = useRef({ reactions: 0, reposts: 0, zapAmount: 0, zapCount: 0 });
  const reactedRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const ownerRef = useRef<string | null>(null);
  const subsRef = useRef<NDKSubscription[]>([]);

  // One render per burst. A popular note's reactions arrive from every relay
  // that carries them, and a setState each would be the render storm again.
  const flush = useCoalesced(() => {
    const owner = ownerRef.current;
    if (!owner) return;

    const root = rootRef.current;
    setState({
      owner,
      root: root
        ? {
            ...root,
            engagement: {
              ...root.engagement,
              reactions: engagementRef.current.reactions,
              reposts: engagementRef.current.reposts,
              replies: repliesRef.current.size,
              zapAmount: engagementRef.current.zapAmount,
              zapCount: engagementRef.current.zapCount,
            },
            userReacted: reactedRef.current,
          }
        : null,
      replies: new Map(repliesRef.current),
      settled: true,
    });
  }, 150);

  const settle = useCallback(() => flush(), [flush]);

  useEffect(() => {
    if (!subscribe || !isConnected || !noteId) return;
    if (ownerRef.current === noteId) return;

    ownerRef.current = noteId;
    rootRef.current = null;
    repliesRef.current = new Map();
    engagementRef.current = { reactions: 0, reposts: 0, zapAmount: 0, zapCount: 0 };
    reactedRef.current = false;
    seenRef.current = new Set();

    // The note itself.
    subsRef.current.push(
      subscribeStream(
        subscribe,
        [{ ids: [noteId] }],
        {
          onEvent: (event: NDKEvent) => {
            const note = toNote(event);
            if (note) rootRef.current = note;
            flush();
          },
          // Settles even when nothing came back, which is what lets the view
          // distinguish "no such note" from "still looking".
          onEose: settle,
        },
        { closeOnEose: false }
      )
    );

    // Replies, both conventions, one subscription.
    //
    // kind:1 with #e is NIP-10; kind:1111 with #e or #E is NIP-22. Reading both
    // costs one filter and catches clients that have moved on, while we still
    // WRITE NIP-10 so our replies stay visible to clients that have not.
    subsRef.current.push(
      subscribeStream(
        subscribe,
        [
          { kinds: [NOTE_KIND], '#e': [noteId] },
          { kinds: [COMMENT_KIND as number], '#e': [noteId] },
          { kinds: [COMMENT_KIND as number], '#E': [noteId] },
        ],
        {
          onEvent: (event: NDKEvent) => {
            if (!event.id || seenRef.current.has(event.id)) return;
            seenRef.current.add(event.id);

            const note = toNote(event);
            if (!note) return;

            const parsed =
              event.kind === COMMENT_KIND
                ? parseCommentTags(event.tags)
                : parseReplyTags(event.tags);

            repliesRef.current.set(note.id, { ...note, replyTo: parsed.replyTo });
            flush();
          },
          onEose: settle,
        },
        { closeOnEose: false }
      )
    );

    // Reactions, reposts and zaps on the root.
    subsRef.current.push(
      subscribeStream(
        subscribe,
        [
          { kinds: [REACTION_KIND], '#e': [noteId] },
          { kinds: [REPOST_KIND], '#e': [noteId] },
          { kinds: [ZAP_RECEIPT_KIND], '#e': [noteId] },
        ],
        {
          onEvent: (event: NDKEvent) => {
            if (!event.id || seenRef.current.has(event.id)) return;
            seenRef.current.add(event.id);

            if (event.kind === REACTION_KIND) {
              engagementRef.current.reactions++;
              if (pubkey && event.pubkey === pubkey) reactedRef.current = true;
            } else if (event.kind === REPOST_KIND) {
              engagementRef.current.reposts++;
            } else if (event.kind === ZAP_RECEIPT_KIND) {
              engagementRef.current.zapCount++;
            }
            flush();
          },
          onEose: settle,
        },
        { closeOnEose: false }
      )
    );
    // No cleanup here on purpose -- stopping on a dependency change kills the
    // subscription before its opening burst arrives. See useAuthorProfiles.
  }, [subscribe, isConnected, noteId, pubkey, flush, settle, relayHints]);

  useEffect(() => {
    return () => {
      for (const sub of subsRef.current) sub.stop();
      subsRef.current = [];
      ownerRef.current = null;
    };
  }, [subscribe, isConnected]);

  const current = state && state.owner === noteId ? state : null;
  const replies = current ? assembleReplies(noteId ?? '', Array.from(current.replies.values())) : [];

  return {
    root: current?.root ?? null,
    replies,
    replyCount: current?.replies.size ?? 0,
    isLoading: Boolean(subscribe && isConnected && noteId) && !current?.settled,
    // Only claim "not found" once the query actually settled. Before that it is
    // indistinguishable from still looking, which is the collapse that has bitten
    // this codebase repeatedly.
    notFound: Boolean(current?.settled) && current?.root === null,
  };
}
