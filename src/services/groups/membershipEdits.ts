/**
 * @fileoverview Safe edits to a group's member list.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * NIP-29 normally makes the RELAY authoritative over membership: a client
 * publishes kind:9000 and the relay maintains kind:39002. Our relay does not
 * run relay29 -- GROUPS_ENABLED is absent from the pod environment, verified
 * against the live pod -- so nothing processes a kind:9000 and no relay-authored
 * 39002 exists. Every 39000/39002 on our relay was authored by the operator's
 * own client.
 *
 * So the model is inverted: THE CLIENT IS AUTHORITATIVE, and kind:39002 is a
 * plain addressable event the key holder publishes.
 *
 * THE HAZARD THAT FOLLOWS FROM THAT: an addressable event REPLACES its
 * predecessor wholesale. Publishing a 39002 containing only the member you just
 * added silently removes everyone else, and it looks like it worked. The same
 * shape destroyed a contact list in this codebase already.
 *
 * Hence: every edit is computed from a FULL READ, and a read that failed
 * produces no publish at all. A failed read followed by a full-list publish is
 * how you delete a group.
 */

import { decodeIdentifier, type Identifier } from '@/services/nostr';

/** What a membership read returned, including whether it can be trusted. */
export interface MemberRead {
  /**
   * False when the query errored OR could not reach a relay. NOT the same as
   * finding zero members, which is why this is a separate field -- an
   * unreachable relay and an empty group are indistinguishable in the member
   * array alone, and treating them alike is what wipes the list.
   */
  ok: boolean;
  members: string[];
}

export type EditRefusal =
  | 'read-failed'
  | 'would-empty'
  | 'no-change'
  | 'unreadable'
  | 'secret-key';

export type EditResult =
  | { ok: true; members: string[] }
  | { ok: false; reason: EditRefusal };

const HEX_64 = /^[0-9a-f]{64}$/i;

/**
 * Turn whatever the user pasted into a hex pubkey.
 *
 * NOBODY HAS A HEX PUBKEY TO HAND. Every Nostr UI shows npub, that is the form
 * people are given and the form they copy, and the add-member field previously
 * accepted only 64-char hex -- so pasting the one identifier you actually
 * possess fell through to 'no-change' and the UI said "Nothing to change".
 *
 * Which is worse than silence: it asserts the input was understood and there
 * was nothing to do, leaving no way to learn the field wanted a different
 * encoding.
 *
 * Accepts hex, npub and nprofile, with surrounding whitespace and an optional
 * `nostr:` prefix, because these arrive by paste.
 *
 * Returns a REASON rather than throwing. decodeIdentifier throws on an nsec by
 * design, and that must become a specific loud refusal here -- somebody pasting
 * a private key into a member field needs telling, not a stack trace.
 */
export function normalizePubkey(input: string): { ok: true; pubkey: string } | { ok: false; reason: EditRefusal } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: 'unreadable' };

  if (HEX_64.test(trimmed)) return { ok: true, pubkey: trimmed.toLowerCase() };

  let decoded: Identifier | null;
  try {
    decoded = decodeIdentifier(trimmed);
  } catch {
    // decodeIdentifier throws only for an nsec.
    return { ok: false, reason: 'secret-key' };
  }

  if (decoded?.type !== 'profile') return { ok: false, reason: 'unreadable' };
  return { ok: true, pubkey: decoded.pubkey };
}

/**
 * The member list after adding someone.
 *
 * Refuses when the read failed, because the alternative is publishing a
 * one-element list over a populated group.
 */
export function membersAfterAdd(read: MemberRead, pubkey: string): EditResult {
  if (!read.ok) return { ok: false, reason: 'read-failed' };

  // Input that cannot be read is NOT 'no-change'. Those are different facts --
  // "already a member" and "I could not understand that" -- and routing the
  // second into the first's bucket produced "Nothing to change" for a perfectly
  // reasonable npub.
  const normalized_ = normalizePubkey(pubkey);
  if (!normalized_.ok) return { ok: false, reason: normalized_.reason };

  const normalized = normalized_.pubkey;
  if (read.members.some((m) => m.toLowerCase() === normalized)) {
    return { ok: false, reason: 'no-change' };
  }

  return { ok: true, members: [...read.members, normalized] };
}

/**
 * The member list after removing someone.
 *
 * Also refuses to publish an EMPTY list. Removing the last member is
 * indistinguishable from a bug that computed an empty set, and the cost of
 * being wrong is the group -- the same reasoning as the emptiness guard in
 * publishContacts.
 */
export function membersAfterRemove(read: MemberRead, pubkey: string): EditResult {
  if (!read.ok) return { ok: false, reason: 'read-failed' };

  // Accepts npub here too. Removal is driven by a button carrying a hex key
  // today, but the asymmetry would be a trap for the next caller.
  const parsed = normalizePubkey(pubkey);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const normalized = parsed.pubkey;
  const next = read.members.filter((m) => m.toLowerCase() !== normalized);

  if (next.length === read.members.length) return { ok: false, reason: 'no-change' };
  if (next.length === 0) return { ok: false, reason: 'would-empty' };

  return { ok: true, members: next };
}

/** Why an edit was refused, in words a user can act on. */
export const REFUSAL_MESSAGE: Record<EditRefusal, string> = {
  'read-failed':
    'Could not read the current member list, so nothing was changed. Publishing now would have removed everyone else.',
  'would-empty': 'That would remove the last member. A group needs at least one.',
  'no-change': 'That person is already a member.',
  unreadable:
    'That does not look like a Nostr public key. Paste an npub (npub1…) or a 64-character hex key.',
  'secret-key':
    'That is a PRIVATE key (nsec), not a public one. It has not been used or stored — treat it as compromised and rotate it.',
};

/** kind:39002 tags for a full member list. */
export function buildMemberTags(groupId: string, members: string[]): string[][] {
  return [['d', groupId], ...members.map((pubkey) => ['p', pubkey])];
}
