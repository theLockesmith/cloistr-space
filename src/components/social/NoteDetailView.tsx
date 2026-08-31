/**
 * @fileoverview One post, with its full context: replies, reactions, zaps.
 *
 * Reached from a note in the feed or from a NIP-19 link pasted from another
 * client. The route parameter may be an nevent (carrying relay hints), a bare
 * note1, or a hex event id.
 */

import { useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom';
import {
  decodeIdentifier,
  decodeHexAs,
  profilePath,
  abbreviate,
  encodeProfile,
  SecretKeyPastedError,
} from '@/services/nostr';
import { useNoteThread, type ThreadReply } from '@/services/social/useNoteThread';
import { useNoteActions, ACTION_BLOCKED_MESSAGE } from '@/services/social';
import { buildReplyTags } from '@/services/social/replyEvents';
import { useAuthorProfiles } from '@/services/profile/useAuthorProfiles';
import type { ThreadNode } from '@/services/social/replyEvents';
import type { Note } from '@/types/social';
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

  return <ThreadBody noteId={resolved.value.id} relays={resolved.value.relays} />;
}

function ThreadBody({ noteId, relays }: { noteId: string; relays: string[] }) {
  const navigate = useNavigate();
  const { root, replies, replyCount, isLoading, notFound } = useNoteThread(noteId, relays);

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

      {featured && (
        <div className="mt-3 flex gap-4 text-xs text-cloistr-light/50">
          <span>{note.engagement.reactions} reactions</span>
          <span>{note.engagement.reposts} reposts</span>
          {note.engagement.zapCount > 0 && <span>{note.engagement.zapCount} zaps</span>}
        </div>
      )}
    </article>
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
