/**
 * @fileoverview Group ownership: derived from event history, not declared.
 *
 * The owner is the pubkey that published the earliest kind:39000 for the
 * group's d-tag. That derivation is intrinsic to the event record — any client
 * can verify it independently, without relay enforcement, without trusting
 * whoever wrote the admin list.
 *
 * WHY THIS MATTERS WITH NIP-29 OFF. kind:39001 is a mutable list: any writer
 * can publish a replacement omitting anyone or adding themselves. A declared
 * "owner" entry in that list would be a promise the protocol cannot keep — a
 * hostile client publishes a replacement kind:39001 and the entry is gone.
 * Derivation from kind:39000 is different: the creation event is already
 * published and cannot be replaced (it was the first, and the relay stores it).
 * Every client that checks the same events will agree on who published first.
 *
 * OWNERSHIP TRANSFER. A tag on a republished kind:39000 is the natural
 * candidate since that kind is already the group's source of truth. This does
 * create a tension with "earliest wins":
 *
 *   - "Earliest wins" applies to finding the GENESIS owner: of all kind:39000
 *     events for the d-tag, the one with the smallest created_at (lowest event
 *     id as tiebreak) determines who created the group.
 *   - Transfers are a chain walk FROM the genesis owner. A transfer is a later
 *     kind:39000 from the current owner naming a successor. The chain is
 *     followed because each hop is signed by the current participant, not
 *     because it is the earliest.
 *
 * The two rules therefore govern different questions — "who created this?"
 * (earliest wins) and "who owns it now?" (chain from genesis) — and do not
 * conflict. Using kind:39000 for transfers is valid because it does not disturb
 * genesis determination: the genesis is always the earliest event overall,
 * regardless of any transfer tags on later events.
 *
 * TIEBREAK. Two events with the same created_at: the one with the
 * lexicographically smaller event id wins. NIP-01 uses this convention for
 * replaceable events with equal timestamps; we follow it for consistency.
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';

/** The kind:39000 tag that signals an ownership transfer. */
export const TRANSFER_TAG = 'transfer-to';

/** Result of resolving the current owner of a group. */
export interface OwnershipResolution {
  /** Pubkey of the current owner — the end of the transfer chain. */
  ownerPubkey: string;
  /** Event id of the genesis kind:39000 that established the group. */
  genesisId: string;
  /** True when the current owner differs from the genesis author. */
  fromTransfer: boolean;
}

/**
 * Find the group's genesis event from a set of kind:39000 events for a d-tag.
 *
 * The genesis is the earliest event: smallest created_at, with the
 * lexicographically smaller event id as a tiebreak when timestamps collide.
 */
export function genesisEvent(events: NDKEvent[]): NDKEvent | null {
  if (events.length === 0) return null;

  return events.reduce((oldest, e) => {
    const tDiff = (e.created_at ?? 0) - (oldest.created_at ?? 0);
    if (tDiff < 0) return e;
    if (tDiff > 0) return oldest;
    // Same timestamp: lower event id wins
    return (e.id ?? '') < (oldest.id ?? '') ? e : oldest;
  });
}

/** Guard against cycles or absurdly long chains in adversarial data. */
const MAX_TRANSFER_DEPTH = 20;

/**
 * Resolve the current owner of a group from all kind:39000 events for its d-tag.
 *
 * Returns null if no events are provided or if the genesis event has no pubkey,
 * which should not happen for any valid Nostr event but is handled explicitly
 * rather than crashing.
 *
 * A claim that contradicts the creation event is rejected: the chain walk only
 * follows events signed by the current participant. An attacker publishing a
 * kind:39000 with a transfer-to tag from a key that is not in the chain cannot
 * insert themselves as the new owner.
 */
export function resolveOwnership(events: NDKEvent[]): OwnershipResolution | null {
  if (events.length === 0) return null;

  const genesis = genesisEvent(events);
  if (!genesis?.pubkey || !genesis.id) return null;

  let currentOwner = genesis.pubkey;
  let fromTransfer = false;
  const visited = new Set<string>();

  for (let i = 0; i < MAX_TRANSFER_DEPTH; i++) {
    if (visited.has(currentOwner)) break; // Cycle detected — stop here
    visited.add(currentOwner);

    // Among all kind:39000 events from the current owner, the LATEST one is
    // authoritative for whether they have transferred. Uses created_at
    // descending; higher event id as tiebreak (deterministic but the inverse
    // of the genesis tiebreak — genesis asks "which came first?", this asks
    // "which is most recent?").
    const ownerEvents = events
      .filter((e) => e.pubkey === currentOwner)
      .sort((a, b) => {
        const tDiff = (b.created_at ?? 0) - (a.created_at ?? 0);
        if (tDiff !== 0) return tDiff;
        return (b.id ?? '') > (a.id ?? '') ? 1 : -1;
      });

    if (ownerEvents.length === 0) break;

    const latest = ownerEvents[0];
    const transferTag = latest.tags.find((t) => t[0] === TRANSFER_TAG && t[1]);
    if (!transferTag) break; // No transfer declared — current owner is the final owner

    currentOwner = transferTag[1];
    fromTransfer = true;
  }

  return { ownerPubkey: currentOwner, genesisId: genesis.id, fromTransfer };
}

/**
 * Whether a pubkey's claim to own a group is consistent with the event history.
 *
 * This is the client-side check the UI enforces before acting on any
 * ownership-gated operation. "This client, and any client that checks the
 * creation event, will recognise the result of this check" — because it only
 * inspects the same publicly available events.
 */
export function ownershipClaimIsValid(events: NDKEvent[], claimedOwner: string): boolean {
  const resolution = resolveOwnership(events);
  if (!resolution) return false;
  return resolution.ownerPubkey === claimedOwner;
}

/**
 * Build tags for an ownership transfer event.
 *
 * The current owner publishes a kind:39000 carrying both the group metadata
 * and a transfer-to tag naming the successor. Any client walking the chain
 * follows this hop because the event is signed by the current owner.
 *
 * Metadata tags are preserved in the same event so the transfer does not
 * inadvertently blank the group's name: kind:39000 is addressable and replaces
 * the previous event wholesale — a transfer event with no name tag wipes it.
 */
export function buildTransferTags(
  groupId: string,
  successorPubkey: string,
  metadata: { name?: string; about?: string; picture?: string }
): string[][] {
  const tags: string[][] = [['d', groupId], [TRANSFER_TAG, successorPubkey]];
  if (metadata.name?.trim()) tags.push(['name', metadata.name.trim()]);
  if (metadata.about?.trim()) tags.push(['about', metadata.about.trim()]);
  if (metadata.picture?.trim()) tags.push(['picture', metadata.picture.trim()]);
  return tags;
}
