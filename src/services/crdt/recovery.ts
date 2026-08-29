/**
 * @fileoverview Recover a contact list that Space overwrote with an empty one.
 *
 * kind:33000 is addressable on d=contacts, so publishing a tagless list does
 * not sit alongside the real one -- it SUPERSEDES it. Measured on
 * relay.cloistr.xyz for the operator: a populated list from 2026-08-02 replaced
 * by a tagless one from 2026-08-24.
 *
 * The superseded event is still retrievable (verified by both an id lookup and
 * a plain kinds+authors query, which this relay answers with every version it
 * holds). So the list is recoverable rather than gone, and recovering it is
 * strictly better than re-importing kind:3 -- it restores what the user
 * actually had here, including NIP-0A state that never existed in kind:3 at all.
 *
 * NOT ALL RELAYS RETAIN SUPERSEDED ADDRESSABLE EVENTS. A relay is entitled to
 * drop the old version on replacement, in which case there is nothing to find
 * and the caller falls back to kind:3. That is why this reports "nothing to
 * recover" as a normal outcome rather than an error.
 */

import type { ContactsCrdtState } from '@/types/contacts';

export interface RecoveryCandidate {
  /** Merged CRDT state from the event worth restoring. */
  state: ContactsCrdtState;
  /** created_at of the event being restored from. */
  restoredFrom: number;
  /** Live entries (follows, excluding tombstones) in that state. */
  contactCount: number;
}

export interface ParsedContactEvent {
  createdAt: number;
  state: ContactsCrdtState;
}

function liveCount(state: ContactsCrdtState): number {
  let n = 0;
  for (const entry of state.entries.values()) {
    if (!entry.deleted) n += 1;
  }
  return n;
}

/**
 * Pick a recovery candidate, or null when there is nothing to recover.
 *
 * Recovery is offered only when the CURRENT state is contentless. If the newest
 * event has entries, the user has a real list -- restoring an older one over it
 * would undo every follow and unfollow made since, which is the same class of
 * destruction this exists to repair.
 *
 * Among older events the one with the MOST live contacts wins rather than the
 * newest. Space may have published more than one empty or partial list before
 * anyone noticed, and "newest non-empty" would happily restore a half-truncated
 * intermediate over the complete list behind it. There is no cost to preferring
 * the fullest: everything here is the same user's own history, and a later
 * unfollow that matters is preserved as a tombstone, which counts as an entry
 * but not as a live contact.
 */
export function selectRecoveryCandidate(
  events: ParsedContactEvent[]
): RecoveryCandidate | null {
  if (events.length === 0) return null;

  const sorted = [...events].sort((a, b) => b.createdAt - a.createdAt);
  const current = sorted[0];

  // A current list with any entry at all -- follow or tombstone -- is a real
  // statement and must not be overwritten.
  if (current.state.entries.size > 0) return null;

  let best: ParsedContactEvent | null = null;
  let bestCount = 0;

  for (const candidate of sorted.slice(1)) {
    const count = liveCount(candidate.state);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  if (!best || bestCount === 0) return null;

  return { state: best.state, restoredFrom: best.createdAt, contactCount: bestCount };
}
