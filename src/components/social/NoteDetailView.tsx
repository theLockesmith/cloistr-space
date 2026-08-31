/**
 * @fileoverview One post, with its full context: replies, reactions, zaps.
 *
 * Reached from a note in the feed or from a NIP-19 link pasted from another
 * client. The route parameter may be an nevent (carrying relay hints), a bare
 * note1, or a hex event id.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom';
import {
  decodeIdentifier,
  decodeHexAs,
  profilePath,
  abbreviate,
  encodeProfile,
  SecretKeyPastedError,
  useNdk,
  subscribeStream,
} from '@/services/nostr';
import { useNoteThread, type ThreadReply } from '@/services/social/useNoteThread';
import { useNoteActions, ACTION_BLOCKED_MESSAGE } from '@/services/social';
import { buildReplyTags } from '@/services/social/replyEvents';
import { useAuthorProfiles } from '@/services/profile/useAuthorProfiles';
import { useEmojiSets } from '@/services/social/useEmojiSets';
import { reactionPayload, type EmojiEntry } from '@/services/social/emojiSets';
import { useMirrorSign } from '@/services/cloistr/useMirrorSign';
import { useLongPressMenu } from '@/services/social/useLongPressMenu';
import { useAuthStore } from '@/stores/authStore';
import { ReactionPicker } from './ReactionPicker';
import { RepostMenu } from './RepostMenu';
import { QuoteComposer } from './QuoteComposer';
import { ShareMenu, ownRelayHints } from './ShareMenu';
import type { ThreadNode } from '@/services/social/replyEvents';
import type { Note } from '@/types/social';
import { REACTION_KIND, REPOST_KIND } from '@/types/social';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { NoteContent } from './NoteContent';

export function NoteDetailView() {
  const { id = '' } = useParams();

  const resolved = useMemo(() => {
    try {
      return { value: decodeIdentifier(id) ?? decodeHexAs(id, 'event'), secret: false };
    } catch (e) {
      if (e instanceof SecretKeyPastedError) return { value: null, secret: true };
      throw e;
    }
  }, [id]);

  if (resolved.secret) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <div className="rounded-lg border border-cloistr-error/40 bg-cloistr-error/10 p-4">
          <h1 className="font-medium text-cloistr-error">That is a private key</h1>
          <p className="mt-2 text-sm text-cloistr-light/80">
            You pasted an <code>nsec</code>, not a link. It has not been used or stored. If you
            pasted it anywhere else, treat it as compromised and rotate it.
          </p>
        </div>
      </div>
    );
  }

  if (!resolved.value || resolved.value.type !== 'event') {
    return <Navigate to="/social" replace />;
  }

  return <ThreadBody noteId={resolved.value.id} relays={resolved.value.relays} author={resolved.value.author} />;
}

function ThreadBody({ noteId, relays, author }: { noteId: string; relays: string[]; author?: string }) {
  const navigate = useNavigate();
  const { root, replies, replyCount, isLoading, notFound } = useNoteThread(noteId, relays, author);

  const authors = useMemo(() => {
    const set = new Set<string>();
    if (root) set.add(root.pubkey);
    const walk = (nodes: ThreadNode<ThreadReply>[]) => {
      for (const n of nodes) {
        set.add(n.event.pubkey);
        walk(n.children);
      }
    };
    walk(replies);
    return Array.from(set);
  }, [root, replies]);

  const profiles = useAuthorProfiles(authors);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <button
        onClick={() => navigate(-1)}
        className="text-sm text-cloistr-primary underline hover:no-underline"
      >
        ← Back
      </button>

      {isLoading && !root && <p className="text-sm text-cloistr-light/50">Loading post…</p>}

      {/* "Not found" is only said once the query settled. Before that it is
          indistinguishable from still looking. */}
      {notFound && (
        <div className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-6 text-center">
          <h2 className="mb-1 font-medium text-cloistr-light">Post not found</h2>
          <p className="text-sm text-cloistr-light/60">
            None of the relays we can reach are carrying it. A link from another client may point at
            a relay we are not connected to.
          </p>
        </div>
      )}

      {root && (
        <>
          <NoteBody note={root} profile={profiles.get(root.pubkey)} featured />
          <ReplyComposer note={root} />

          <section>
            <h2 className="mb-2 text-sm font-medium text-cloistr-light/60">
              {replyCount === 0 ? 'No replies yet' : `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
            </h2>
            <ReplyTree nodes={replies} profiles={profiles} rootId={root.id} />
          </section>
        </>
      )}
    </div>
  );
}

function ReplyTree({
  nodes,
  profiles,
  rootId,
}: {
  nodes: ThreadNode<ThreadReply>[];
  profiles: Map<string, { name?: string; displayName?: string; picture?: string }>;
  rootId: string;
}) {
  return (
    <ul className="space-y-3">
      {nodes.map((node) => (
        <li key={node.event.id}>
          {/* Indent is capped by assembleReplies' depth bound, so a deep thread
              cannot push content off the side of a phone. */}
          <div style={{ marginLeft: `${Math.min(node.depth, 4) * 12}px` }}>
            <NoteBody note={node.event} profile={profiles.get(node.event.pubkey)} />
          </div>
          {node.children.length > 0 && (
            <div className="mt-3">
              <ReplyTree nodes={node.children} profiles={profiles} rootId={rootId} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function NoteBody({
  note,
  profile,
  featured = false,
}: {
  note: Note;
  profile?: { name?: string; displayName?: string; picture?: string };
  featured?: boolean;
}) {
  const name = profile?.displayName || profile?.name || abbreviate(encodeProfile(note.pubkey));

  return (
    <article
      className={`rounded-lg border border-cloistr-light/10 p-4 ${
        featured ? 'bg-cloistr-light/[0.07]' : 'bg-cloistr-light/5'
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <Link
          to={profilePath(note.pubkey)}
          className="truncate text-sm font-medium text-cloistr-light hover:underline"
        >
          {name}
        </Link>
        <span className="shrink-0 text-xs text-cloistr-light/40">
          {new Date(note.createdAt * 1000).toLocaleString()}
        </span>
      </div>

      <NoteContent content={note.content} compact={!featured} />

      {/* The featured (root) note gets interactive action buttons. Reply
          cards navigate to their own thread when clicked, where they become
          the featured note and get their own action row. */}
      {featured && <NoteActions note={note} />}
    </article>
  );
}

/**
 * Track whether the current user has reacted to / reposted a specific note,
 * and which of their events to reference in a NIP-09 retraction.
 *
 * Only needed in views that don't run useFeed (which carries the same
 * tracking). The subscription is cheap: authors:[pubkey] + #e:[noteId]
 * is at most a handful of events from the relay's perspective.
 *
 * The event id lives in a ref, not state, because it does not trigger a
 * re-render on its own — the boolean flag does that. The ref is what
 * survives into the undo handler without a stale-closure hazard.
 */
function useNoteOwnEngagement(noteId: string) {
  const { subscribe, isConnected } = useNdk();
  const { pubkey } = useAuthStore();

  const [reacted, setReacted] = useState(false);
  const [reposted, setReposted] = useState(false);
  const ownReactionIdRef = useRef<string | undefined>(undefined);
  const ownRepostIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!subscribe || !isConnected || !pubkey) return;

    const sub = subscribeStream(
      subscribe,
      [{ kinds: [REACTION_KIND, REPOST_KIND], '#e': [noteId], authors: [pubkey] }],
      {
        onEvent: (event: NDKEvent) => {
          if (!event.id) return;
          if (event.kind === REACTION_KIND) {
            setReacted(true);
            ownReactionIdRef.current = event.id;
          } else if (event.kind === REPOST_KIND) {
            setReposted(true);
            ownRepostIdRef.current = event.id;
          }
        },
      }
    );

    return () => sub.stop();
  }, [subscribe, isConnected, pubkey, noteId]);

  return {
    reacted,
    setReacted,
    reposted,
    setReposted,
    getOwnReactionId: () => ownReactionIdRef.current,
    setOwnReactionId: (id: string | undefined) => {
      ownReactionIdRef.current = id;
    },
    getOwnRepostId: () => ownRepostIdRef.current,
    setOwnRepostId: (id: string | undefined) => {
      ownRepostIdRef.current = id;
    },
  };
}

/**
 * Action row for the featured (root) note in a thread.
 *
 * React with undo, repost / quote / undo-repost, and share. Same discipline
 * as the feed: optimistic update on tap, visible revert on failure. Same
 * "still loading" message when we know the user reacted but not with which
 * event — that is a distinct state from "did not react" and must not look
 * identical.
 *
 * NOT shown on reply cards: clicking a reply navigates to its own thread,
 * where it becomes the featured note and gets this row.
 */
function NoteActions({ note }: { note: Note }) {
  const { react, repost, undo, canAct } = useNoteActions();
  const { relayStatuses } = useNdk();
  const quoteHints = useMemo(() => ownRelayHints(relayStatuses), [relayStatuses]);
  const { emoji, isLoading: emojiLoading } = useEmojiSets();
  const { mirrorMap, isSigning } = useMirrorSign();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    reacted,
    setReacted,
    reposted,
    setReposted,
    getOwnReactionId,
    setOwnReactionId,
    getOwnRepostId,
    setOwnRepostId,
  } = useNoteOwnEngagement(note.id);

  const handleReact = useCallback(
    async (entry?: EmojiEntry) => {
      if (!canAct) return;

      // Tapping a filled heart retracts it. We need the id of our own kind:7
      // to name in the kind:5 — a boolean "I reacted" is not enough.
      if (!entry && reacted) {
        const reactionId = getOwnReactionId();
        if (!reactionId) {
          // We know the user reacted (relay returned their kind:7) but the
          // echo has not supplied its id yet. Saying so beats doing nothing.
          setActionError(
            'Cannot undo this reaction yet — still loading which one was yours.'
          );
          return;
        }

        setActionError(null);
        setReacted(false);

        try {
          await undo(reactionId);
          setOwnReactionId(undefined);
        } catch (err) {
          // Revert visibly. A heart left empty after a failed retraction
          // claims something that did not happen.
          setReacted(true);
          setOwnReactionId(reactionId);
          setActionError(
            err instanceof Error
              ? `Reaction not removed. ${err.message}`
              : 'Reaction not removed.'
          );
        }
        return;
      }

      setActionError(null);
      setReacted(true);

      const payload = entry ? reactionPayload(entry) : null;
      try {
        const outcome = await react(note.id, note.pubkey, payload?.content, payload?.tags);
        // Record what we just sent so undo can reference it at once, before
        // the relay echo comes back.
        setOwnReactionId(outcome.eventId);
      } catch (err) {
        setReacted(false);
        setActionError(
          err instanceof Error ? `Reaction not sent. ${err.message}` : 'Reaction not sent.'
        );
      }
    },
    [canAct, react, undo, reacted, getOwnReactionId, setReacted, setOwnReactionId, note.id, note.pubkey]
  );

  const handleRepost = useCallback(async () => {
    if (!canAct) return;

    if (reposted) {
      const repostId = getOwnRepostId();
      if (!repostId) {
        setActionError(
          'Cannot undo this repost yet — still loading which one was yours.'
        );
        return;
      }

      setActionError(null);
      setReposted(false);

      try {
        await undo(repostId);
        setOwnRepostId(undefined);
      } catch (err) {
        setReposted(true);
        setOwnRepostId(repostId);
        setActionError(
          err instanceof Error
            ? `Repost not removed. ${err.message}`
            : 'Repost not removed.'
        );
      }
      return;
    }

    setActionError(null);
    setReposted(true);

    try {
      const outcome = await repost(note.id, note.pubkey);
      setOwnRepostId(outcome.eventId);
    } catch (err) {
      setReposted(false);
      setActionError(
        err instanceof Error ? `Repost not sent. ${err.message}` : 'Repost not sent.'
      );
    }
  }, [canAct, repost, undo, reposted, getOwnRepostId, setReposted, setOwnRepostId, note.id, note.pubkey]);

  // Plain click sends the default heart. Hold, right-click or ArrowDown
  // open the emoji picker.
  const { handlers: reactHandlers } = useLongPressMenu({
    onOpen: () => setPickerOpen(true),
    onActivate: () => void handleReact(),
    disabled: !canAct,
  });

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-5">
        <RepostMenu
          isReposted={reposted}
          canAct={canAct}
          count={note.engagement.reposts}
          onToggle={() => void handleRepost()}
          onQuote={() => setQuoting(true)}
        />

        <div className="relative">
          <button
            {...reactHandlers}
            disabled={!canAct}
            aria-disabled={!canAct}
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            title={
              canAct
                ? 'Click to react. Hold or right-click to choose an emoji.'
                : undefined
            }
            className={`flex items-center gap-2 text-sm ${
              !canAct
                ? 'cursor-not-allowed text-cloistr-light/20'
                : reacted
                  ? 'text-cloistr-error'
                  : 'text-cloistr-light/40 hover:text-cloistr-error'
            }`}
          >
            <svg
              className="h-5 w-5"
              fill={reacted ? 'currentColor' : 'none'}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
            {note.engagement.reactions > 0 && note.engagement.reactions}
          </button>

          {pickerOpen && (
            <ReactionPicker
              emoji={emoji}
              isLoading={emojiLoading}
              mirrorMap={mirrorMap}
              isMirroring={isSigning}
              onPick={(entry) => {
                setPickerOpen(false);
                void handleReact(entry);
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>

        <ShareMenu noteId={note.id} authorPubkey={note.pubkey} />
      </div>

      {actionError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded bg-cloistr-error/10 p-2 text-xs text-cloistr-error"
        >
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            aria-label="Dismiss"
            className="ml-auto shrink-0 opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {quoting && (
        <QuoteComposer note={note} relays={quoteHints} onDone={() => setQuoting(false)} />
      )}
    </div>
  );
}

function ReplyComposer({ note }: { note: Note }) {
  const { reply, canAct, blockedReason } = useNoteActions();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);

    try {
      await reply(text, buildReplyTags({ id: note.id, pubkey: note.pubkey }));
      setText('');
    } catch (e) {
      setError(e instanceof Error ? `Reply not sent. ${e.message}` : 'Reply not sent.');
    } finally {
      setBusy(false);
    }
  }, [text, busy, reply, note.id, note.pubkey]);

  if (!canAct) {
    return (
      <p role="status" className="text-xs text-cloistr-light/50">
        {blockedReason ? ACTION_BLOCKED_MESSAGE[blockedReason] : 'Replying is unavailable.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        rows={3}
        value={text}
        placeholder="Write a reply…"
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
      />
      {error && (
        <p role="alert" className="text-xs text-cloistr-error">
          {error}
        </p>
      )}
      <button
        onClick={() => void submit()}
        disabled={busy || !text.trim()}
        className="rounded bg-cloistr-primary px-4 py-2 text-sm text-cloistr-dark disabled:opacity-50"
      >
        {busy ? 'Posting…' : 'Reply'}
      </button>
    </div>
  );
}
