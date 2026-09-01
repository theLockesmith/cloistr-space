/**
 * @fileoverview Group ownership: anchored in the d-tag, not in event timestamps.
 *
 * ## The original design and why it was wrong
 *
 * The first attempt derived ownership from the earliest kind:39000 for the
 * d-tag — "genesisEvent()" returned the event with the smallest created_at,
 * and its pubkey was the owner. Two independent failures:
 *
 * FAILURE 1 — created_at is author-controlled. A Nostr event's timestamp is an
 * integer the author writes themselves; no relay enforces its relationship to
 * wall time. Any attacker publishes:
 *
 *   kind:39000, ["d", "<victim-group>"], created_at: 1
 *
 * and becomes the genesis owner of any group they can see, by construction.
 * The event is validly signed; it just claims to be old.
 *
 * FAILURE 2 — kind:39000 is addressable (parameterized replaceable). Relays
 * keep only the newest event per (kind, pubkey, d-tag). useGroupAdmin.updateMetadata
 * republishes kind:39000 — a feature the product explicitly supports. The first
 * time anyone renames a group, the creation event is REPLACED at relays and
 * ceases to exist. The anchor the scheme depended on is deleted by ordinary
 * product use.
 *
 * ## The corrected design
 *
 * The d-tag is the group's permanent address and is used by every query. Embed
 * the creator's pubkey into it. Ownership is then verifiable from the identifier
 * itself — no history query, no reliance on an event that gets replaced, and no
 * timestamp to forge.
 *
 * Format:  {name-slug}-{16-hex-pubkey-prefix}-{8-hex-random}
 *
 * The 16-char (8-byte, 64-bit) pubkey prefix is sized as a deliberate
 * tradeoff, not a cryptographic guarantee. Finding a keypair whose pubkey
 * starts with a given 16-char prefix requires ~2^64 secp256k1 scalar
 * multiplications — NOT hash operations (GPU hashrate figures do not apply
 * here). GPU vanity-key generators reach roughly 10^9 derivations per second,
 * so ~2^64 costs on the order of 585 GPU-years: expensive, but reachable for
 * a well-funded attacker. That is the right tradeoff for a productivity-suite
 * group where nobody spends thousands of GPU-years to hijack a project. If
 * that assumption ever stops holding, the prefix length is the dial — 20 chars
 * doubles the work factor. The 8-char random suffix prevents duplicate
 * identifiers from the same creator.
 *
 * ## Privacy disclosure
 *
 * kind:39000 carries the creator's full 64-char pubkey in its event pubkey
 * field. Anyone who can address the group by its d-tag can fetch that event
 * and see the complete pubkey. The identifier embeds 16 of those 64 chars —
 * strictly less than what the event already discloses. No new information is
 * leaked to anyone who can already find the group.
 *
 * ## Ownership transfer
 *
 * Unchanged from the original design — anchoring on the d-tag prefix does not
 * affect the transfer chain. The genesis owner (whose pubkey matches the prefix)
 * publishes a kind:39000 with a ["transfer-to", successorPubkey] tag. The chain
 * walks from there, following events signed by each current participant.
 *
 * ## Legacy groups
 *
 * Groups created before this scheme have d-tags without embedded pubkeys. Their
 * ownership is NOT recoverable: we do not fall back to earliest-wins, because
 * that reintroduces failure 1 for exactly the groups that cannot defend against
 * it. Legacy groups surface a distinct "unverifiable" state in the UI.
 *
 * ## genesisEvent()
 *
 * The function is kept because its tests document why it was wrong and provide
 * a regression fixture. It is NOT used for ownership resolution. Do not use it
 * to determine who owns a group.
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';

// ---------------------------------------------------------------------------
// Identifier format
// ---------------------------------------------------------------------------

/**
 * Pattern for a pubkey-aware group identifier.
 *
 * The last two segments are:
 *   - [0-9a-f]{16}  : first 16 hex chars of the creator's pubkey
 *   - [0-9a-f]{8}   : 8 hex chars of crypto.getRandomValues entropy
 *
 * The slug before them is [a-z0-9-]+. The regex is anchored at $ so it always
 * extracts the last 16-char hex segment preceding the final 8-char hex segment,
 * regardless of what the slug contains.
 */
const OWNER_PATTERN = /^[a-z0-9-]+-([0-9a-f]{16})-[0-9a-f]{8}$/;

/**
 * Extract the creator's pubkey prefix from a pubkey-aware group identifier.
 *
 * Returns null for legacy identifiers — those whose d-tags do not embed a
 * pubkey. The caller treats null as "ownership unverifiable".
 */
export function extractOwnerPrefix(identifier: string): string | null {
  const m = OWNER_PATTERN.exec(identifier);
  return m ? m[1] : null;
}

/**
 * Build a pubkey-aware group identifier.
 *
 * Called by useGroupActions.createGroup; exported for tests. The random suffix
 * uses crypto.getRandomValues rather than Math.random so the entropy source is
 * not predictable, which matters when the identifier appears in a security-
 * relevant context (it carries the authority claim).
 *
 * The 16-hex pubkey prefix is placed second-to-last so OWNER_PATTERN can
 * extract it with a simple anchored regex regardless of the slug's content.
 */
export function buildGroupIdentifier(name: string, creatorPubkey: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
  const pubkeyPrefix = creatorPubkey.slice(0, 16);
  const randomBytes = crypto.getRandomValues(new Uint8Array(4));
  const randomHex = Array.from(randomBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${slug}-${pubkeyPrefix}-${randomHex}`;
}

// ---------------------------------------------------------------------------
// Ownership resolution
// ---------------------------------------------------------------------------

/** The kind:39000 tag that signals an ownership transfer. */
export const TRANSFER_TAG = 'transfer-to';

/** Guard against cycles or absurdly long chains in adversarial data. */
const MAX_TRANSFER_DEPTH = 20;

/**
 * The result of resolving group ownership.
 *
 * Two states:
 *   'owner'  — the chain resolved; ownerPubkey is the current owner.
 *   'legacy' — the d-tag does not embed a pubkey; ownership is unverifiable.
 *
 * 'legacy' is NOT a fallback to earliest-wins. Falling back would reintroduce
 * the timestamp-forgery attack for exactly the groups that cannot defend against
 * it, because they predate pubkey-aware identifiers.
 */
export type OwnershipResolution =
  | { status: 'owner'; ownerPubkey: string; fromTransfer: boolean }
  | { status: 'legacy' };

/**
 * Resolve the current owner of a group.
 *
 * The identifier (d-tag) is the primary input: the 16-char pubkey prefix it
 * carries identifies the creator WITHOUT relying on any event timestamp. The
 * events argument provides the set of kind:39000 events for this d-tag, used
 * to walk the transfer chain.
 *
 * Returns { status: 'legacy' } when:
 *   - The identifier does not embed a pubkey prefix (created before this scheme)
 *   - No event from a pubkey matching the prefix is found in events
 *     (the creator's event is not on this relay — treated as unresolvable)
 *
 * The second case should not occur for a properly created group, because
 * createGroup publishes kind:39000 immediately and kind:39000 is replaceable
 * (the creator's latest event always exists on the relay).
 */
export function resolveOwnership(
  identifier: string,
  events: NDKEvent[]
): OwnershipResolution {
  const prefix = extractOwnerPrefix(identifier);
  if (!prefix) return { status: 'legacy' };

  // Find the creator's events: pubkeys starting with the embedded prefix.
  // ~2^64 secp256k1 scalar multiplications are needed to find a pubkey sharing
  // the embedded 16-char prefix, so any match is the creator. Multiple matches
  // indicate a collision attack; take the first — the attacker already bore
  // that cost.
  const creatorEvents = events.filter((e) => e.pubkey.startsWith(prefix));
  if (creatorEvents.length === 0) return { status: 'legacy' };

  // The creator's full pubkey (read from their event, confirmed by the prefix).
  const creatorPubkey = creatorEvents[0].pubkey;

  // Walk the transfer chain from the creator forward.
  let currentOwner = creatorPubkey;
  let fromTransfer = false;
  const visited = new Set<string>();

  for (let i = 0; i < MAX_TRANSFER_DEPTH; i++) {
    if (visited.has(currentOwner)) break; // Cycle detected — stop here
    visited.add(currentOwner);

    // Among events from the current owner, the LATEST determines whether
    // they have transferred. Created_at descending; higher event id as tiebreak
    // (deterministic; the inverse of the genesis tiebreak because this asks
    // "what is the most recent state?" rather than "what came first?").
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
    if (!transferTag) break;

    currentOwner = transferTag[1];
    fromTransfer = true;
  }

  return { status: 'owner', ownerPubkey: currentOwner, fromTransfer };
}

/**
 * Whether a pubkey's claim to own a group is consistent with the identifier.
 *
 * Any client running the same check against the same events reaches the same
 * conclusion — this is the property that makes derivation stronger than
 * declaration. The UI copy says "this client, and any client that checks the
 * creation event" because that is literally what this function does.
 */
export function ownershipClaimIsValid(
  identifier: string,
  events: NDKEvent[],
  claimedOwner: string
): boolean {
  const resolution = resolveOwnership(identifier, events);
  if (resolution.status !== 'owner') return false;
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
 * the previous event wholesale — a transfer with no name tag wipes it.
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

// ---------------------------------------------------------------------------
// genesisEvent — kept as a documented negative example, NOT for ownership use
// ---------------------------------------------------------------------------

/**
 * @deprecated NOT USED FOR OWNERSHIP RESOLUTION.
 *
 * This function returns the kind:39000 event with the earliest created_at for
 * a d-tag. It exists only to document the original broken approach and serve
 * as a regression fixture for why "earliest wins" fails.
 *
 * DO NOT use this to determine who owns a group. created_at is author-
 * controlled — an attacker can publish created_at: 1 and become the "genesis"
 * of any group they can see. The tests in ownership.test.ts show this attack
 * explicitly.
 *
 * Ownership is derived from the d-tag's embedded pubkey prefix instead.
 * See resolveOwnership().
 *
 * Tiebreak: same created_at → lexicographically smaller event id wins.
 * NIP-01 convention for replaceable events with equal timestamps.
 */
export function genesisEvent(events: NDKEvent[]): NDKEvent | null {
  if (events.length === 0) return null;

  return events.reduce((oldest, e) => {
    const tDiff = (e.created_at ?? 0) - (oldest.created_at ?? 0);
    if (tDiff < 0) return e;
    if (tDiff > 0) return oldest;
    return (e.id ?? '') < (oldest.id ?? '') ? e : oldest;
  });
}
