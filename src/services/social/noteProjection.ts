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
import type { Note } from '@/types/social';

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
