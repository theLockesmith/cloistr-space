/**
 * @fileoverview Who is allowed to write a group's admin and member lists.
 *
 * ## The gap this closes
 *
 * kind:39001 (admins) and kind:39002 (members) are addressable events keyed by
 * (kind, pubkey, d-tag). Every pubkey therefore gets its OWN copy at the relay,
 * and our relay does not run relay29, so nothing server-side rejects a write
 * from a non-admin.
 *
 * The client used to fetch these by kind and `#d` alone, with no `authors`
 * filter, then merge everything it got back with "latest created_at wins". So
 * any pubkey could publish:
 *
 *   kind:39002, ["d", "<victim-group>"], ["p", "<attacker>"]
 *
 * and appear in the group's member list. Publishing a kind:39001 naming itself
 * with full permissions made it an admin in the UI. Worse than the display:
 * useGroupAdmin reads the same unfiltered list as the base for the next edit,
 * so the owner's next legitimate change would republish the attacker's entry
 * under the OWNER's key, laundering the injection into a trusted event.
 *
 * MR !116 identified this and deferred it, on the grounds that filtering by
 * trusted authors needs to know who the trusted authors are, which comes from
 * the admin list, which is the thing being filtered.
 *
 * ## Why it is not actually circular
 *
 * The circle breaks at the d-tag. ownership.ts embeds the creator's 16-char
 * pubkey prefix in the group identifier itself, so the owner is derivable from
 * the group's ADDRESS without trusting any event. That is a fixed point no
 * attacker can move, and everything else hangs off it:
 *
 *   owner            <- the d-tag (unforgeable without ~2^64 EC operations)
 *   admin list       <- the latest kind:39001 SIGNED BY THE OWNER
 *   member list      <- the latest kind:39002 signed by the owner, or by an
 *                       admin the owner's list grants add-user/remove-user
 *
 * ## Deliberate narrowing: the admin list is owner-only
 *
 * An admin holding add-permission/remove-permission can no longer write the
 * admin list in a way this client reads. That is a real reduction and it is
 * chosen: any wider rule needs a delegation chain with revocation semantics,
 * and a monotone "once trusted, always trusted" closure would mean removing
 * someone's add-permission does not remove their ability to rewrite the list.
 * Getting that wrong reintroduces the bug with extra steps. Member management,
 * which is the everyday operation, still works for delegated admins.
 *
 * ## Legacy groups
 *
 * Identifiers created before the pubkey-aware scheme carry no owner prefix, so
 * there is no anchor and no filtering is possible. They report 'unverifiable'.
 * The caller shows the list and says it cannot be verified, rather than
 * silently presenting forgeable data as fact or hiding the only groups that
 * currently exist. Measured against relay.cloistr.xyz on 2026-09-02: 3 distinct
 * kind:39000 d-tags, all 3 legacy, 0 pubkey-aware. Every group created since
 * useGroupActions.createGroup adopted buildGroupIdentifier is verifiable, so
 * this is a shrinking set, but it is not empty today and failing closed on it
 * would remove membership from every group that exists.
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { AdminPermission } from '@/types/groups';
import { GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND, GROUP_METADATA_KIND } from '@/types/groups';
import { resolveOwnership } from './ownership';

/** Permissions that make an admin a trusted writer of the MEMBER list. */
const MEMBER_WRITE_PERMISSIONS: AdminPermission[] = ['add-user', 'remove-user'];

export interface AdminEntry {
  pubkey: string;
  permissions: AdminPermission[];
}

/**
 * Who may write this group's lists.
 *
 * 'resolved'      — the d-tag carries an owner prefix; filtering applies.
 * 'unverifiable'  — legacy identifier, no anchor, nothing can be filtered.
 */
export type TrustedWriters =
  | {
      status: 'resolved';
      owner: string;
      /** Admins as declared by the latest owner-signed kind:39001. */
      admins: AdminEntry[];
      /** Pubkeys whose kind:39002 is authoritative: owner + member-managing admins. */
      memberWriters: Set<string>;
    }
  | { status: 'unverifiable' };

/**
 * The newest event among a set of authors.
 *
 * created_at descending, event id descending as the tiebreak. The tiebreak is
 * not cosmetic: two events with the same created_at must resolve the same way
 * on every client, or two people looking at the same group see different
 * members. ownership.ts uses the same rule for the same reason.
 */
function latestFrom(events: NDKEvent[], authors: Set<string>): NDKEvent | null {
  const eligible = events.filter((e) => authors.has(e.pubkey));
  if (eligible.length === 0) return null;

  return eligible.sort((a, b) => {
    const byTime = (b.created_at ?? 0) - (a.created_at ?? 0);
    if (byTime !== 0) return byTime;
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  })[0];
}

/** `["p", pubkey, ...permissions]` rows of a kind:39001. */
export function parseAdminEntries(event: NDKEvent | null): AdminEntry[] {
  if (!event) return [];
  return event.tags
    .filter((t) => t[0] === 'p' && t[1])
    .map((t) => ({ pubkey: t[1], permissions: t.slice(2) as AdminPermission[] }));
}

/** `["p", pubkey]` rows of a kind:39002. */
export function parseMemberPubkeys(event: NDKEvent | null): string[] {
  if (!event) return [];
  return event.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]);
}

/**
 * Resolve who may write this group's lists.
 *
 * `events` is the full result of one query for kinds 39000/39001/39002 on the
 * group's d-tag; this function partitions it. Passing everything in one call
 * keeps the three reads on a single consistent snapshot, which matters because
 * resolving the owner from a different fetch than the one that produced the
 * admin list opens a window where they disagree.
 */
export function resolveTrustedWriters(identifier: string, events: NDKEvent[]): TrustedWriters {
  const metadata = events.filter((e) => e.kind === GROUP_METADATA_KIND);
  const adminEvents = events.filter((e) => e.kind === GROUP_ADMINS_KIND);

  const ownership = resolveOwnership(identifier, metadata);
  if (ownership.status !== 'owner') return { status: 'unverifiable' };

  const owner = ownership.ownerPubkey;

  // Owner-only, by design. See the file comment.
  const admins = parseAdminEntries(latestFrom(adminEvents, new Set([owner])));

  const memberWriters = new Set<string>([owner]);
  for (const entry of admins) {
    if (entry.permissions.some((p) => MEMBER_WRITE_PERMISSIONS.includes(p))) {
      memberWriters.add(entry.pubkey);
    }
  }

  return { status: 'resolved', owner, admins, memberWriters };
}

/**
 * The authoritative member list, or null when it cannot be established.
 *
 * null is NOT an empty group. The caller must keep those apart: publishing an
 * edit computed from "no members" when the truth is "could not tell" removes
 * everyone. This is the same distinction useGroupAdmin's `ok` flag carries.
 */
export function authoritativeMembers(
  writers: TrustedWriters,
  events: NDKEvent[]
): string[] | null {
  if (writers.status !== 'resolved') return null;
  const memberEvents = events.filter((e) => e.kind === GROUP_MEMBERS_KIND);
  return parseMemberPubkeys(latestFrom(memberEvents, writers.memberWriters));
}
