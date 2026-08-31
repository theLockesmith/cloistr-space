/**
 * @fileoverview Write a comment on top of someone else's post.
 *
 * A quote repost is a kind:1 of our own that POINTS AT the original, not a
 * kind:6 that carries it. So it needs a composer, and the original is shown
 * while writing -- quoting something you cannot see while you type is how you
 * end up commenting on the wrong post.
 *
 * The quoted event goes into the content as a `nostr:nevent1…` reference AND
 * into a `q` tag. The tag is what clients index on; the inline reference is what
 * clients that do not read `q` tags render, and it is what our own NoteContent
 * turns back into a link. Emitting only one of the two makes the quote
 * invisible in half the ecosystem.
 */

import { useCallback, useState } from 'react';
import { useCompose } from '@/services/social';
import { encodeEvent } from '@/services/nostr';
import type { Note } from '@/types/social';

interface Props {
  note: Note;
  /** Relay hints for the nevent, so the quote resolves for other clients. */
  relays: string[];
  onDone: () => void;
}

export function QuoteComposer({ note, relays, onDone }: Props) {
  const { post, isPosting } = useCompose();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!text.trim() || isPosting) return;
    setError(null);

    try {
      const nevent = encodeEvent(note.id, relays, note.pubkey);
      await post(`${text.trim()}\n\nnostr:${nevent}`, {
        quote: note.id,
        // p-tag the author so they learn they were quoted. Without it a quote
        // is a conversation about someone that they never hear.
        mentions: [note.pubkey],
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? `Quote not posted. ${e.message}` : 'Quote not posted.');
    }
  }, [text, isPosting, post, note.id, note.pubkey, relays, onDone]);

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-3">
      <textarea
        rows={3}
        autoFocus
        value={text}
        placeholder="Add your comment…"
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
      />

      {/* The post being quoted, so you can see what you are commenting on. */}
      <div className="rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2">
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs text-cloistr-light/60">
          {note.content}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-xs text-cloistr-error">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => void submit()}
          disabled={isPosting || !text.trim()}
          className="rounded bg-cloistr-primary px-3 py-1.5 text-sm text-cloistr-dark disabled:opacity-50"
        >
          {isPosting ? 'Posting…' : 'Post quote'}
        </button>
        <button onClick={onDone} className="rounded px-3 py-1.5 text-sm text-cloistr-light/60">
          Cancel
        </button>
      </div>
    </div>
  );
}
