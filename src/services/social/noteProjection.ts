/**
 * @fileoverview Project an NDK event into the Note shape the UI renders.
 *
 * Extracted because this is now needed in three places -- the feed, a profile's
 * notes, and a thread -- and a third hand-rolled copy is where the shapes start
 * to diverge. useFeed keeps its own richer version for now: it also extracts
 * media and reply markers, and it is the file that has taken the most fixes
 * tonight. Pulling it in here would be a fourth change to it in one session,
 * which is a worse trade than a documented duplicate.
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { NOTE_KIND, type Note } from '@/types/social';

/** Engagement starts empty; it is folded in separately by whoever tracks it. */
export const EMPTY_ENGAGEMENT = {
  reactions: 0,
  replies: 0,
  reposts: 0,
  zapAmount: 0,
  zapCount: 0,
};

/**
 * Returns null for an event that cannot be rendered as a note.
 *
 * An event with no id or no pubkey is not a note we can key, link to, or
 * attribute -- and putting it in the list would crash the renderer somewhere
 * further away from the cause.
 */
export function toNote(event: NDKEvent): Note | null {
  if (!event.id || !event.pubkey) return null;

  return {
    id: event.id,
    pubkey: event.pubkey,
    content: event.content ?? '',
    createdAt: event.created_at ?? 0,
    mentions: event.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]),
    hashtags: event.tags.filter((t) => t[0] === 't' && t[1]).map((t) => t[1]),
    media: [],
    engagement: { ...EMPTY_ENGAGEMENT },
    userReacted: false,
    userReposted: false,
    userZapped: false,
  };
}

/**
 * A plain Nostr event object as it arrives in JSON form.
 * Used when parsing embedded events from kind:6 content.
 */
export interface RawEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
}

/**
 * Try to parse a kind:1 event from the content field of a kind:6 repost.
 *
 * NIP-18 says the content SHOULD be the full JSON-encoded original event.
 * Not every client sends it, and stranger-authored JSON must be validated
 * before any field is used. Returns null for anything that fails validation
 * rather than throwing -- the caller skips the note silently.
 *
 * Security notes:
 *   - Every field is type-checked before use. A missing or wrong-typed field
 *     returns null rather than a partial object that would crash the renderer.
 *   - Tags are filtered to arrays of strings. A [[0, null]] tag would otherwise
 *     pass as string[][] and crash on .slice() or .toLowerCase().
 *   - kind must equal NOTE_KIND (1). A kind:6 embedding another kind:6 is not
 *     a note; accepting it would surface non-text content as if it were text.
 */
export function tryParseEmbeddedNote(raw: string): RawEvent | null {
  if (!raw?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const e = parsed as Partial<RawEvent>;
    if (
      typeof e.id !== 'string' || !e.id ||
      typeof e.pubkey !== 'string' || !e.pubkey ||
      e.kind !== NOTE_KIND ||
      !Array.isArray(e.tags)
    ) return null;
    // Filter tags: each must be an array of strings. A relay that sends a
    // non-string tag value inside an embedded event would otherwise produce a
    // tag[] that looks like string[][] but is not.
    const tags = e.tags.filter(
      (t): t is string[] =>
        Array.isArray(t) && t.every((v) => typeof v === 'string')
    );
    return {
      id: e.id,
      pubkey: e.pubkey,
      kind: NOTE_KIND,
      created_at: typeof e.created_at === 'number' ? e.created_at : 0,
      content: typeof e.content === 'string' ? e.content : '',
      tags,
    };
  } catch {
    return null;
  }
}
