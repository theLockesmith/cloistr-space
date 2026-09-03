/**
 * @fileoverview Tests for member/admin list authorship.
 *
 * Every test here is a statement about an attacker who can publish validly
 * signed events, because that is the only attacker there is: kind:39001 and
 * kind:39002 are ordinary addressable events and our relay does not enforce
 * group ACLs. The question is never "was the event signed" (it always is), it
 * is "whose signature did we agree to believe".
 */

import { describe, it, expect } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import {
  resolveTrustedWriters,
  authoritativeMembers,
  parseAdminEntries,
  parseMemberPubkeys,
} from './trustedWriters';
import { GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND, GROUP_METADATA_KIND } from '@/types/groups';

const ALICE = 'a'.repeat(64); // owner
const BOB = 'b'.repeat(64); // admin with member-management
const CAROL = 'c'.repeat(64); // ordinary member
const EVE = 'e'.repeat(64); // attacker

/** A pubkey-aware identifier, the form buildGroupIdentifier produces. */
function idFor(pubkey: string): string {
  return `test-group-${pubkey.slice(0, 16)}-deadbeef`;
}

const GROUP = idFor(ALICE);
const LEGACY_GROUP = 'old-group-without-a-pubkey';

let seq = 0;
function evt(
  kind: number,
  pubkey: string,
  created_at: number,
  tags: string[][],
  id?: string
): NDKEvent {
  return {
    kind,
    pubkey,
    created_at,
    id: id ?? `${(seq++).toString(16).padStart(64, '0')}`,
    tags: [['d', GROUP], ...tags],
  } as unknown as NDKEvent;
}

/** kind:39000 from the owner — what makes ownership resolvable at all. */
function metadata(pubkey: string, created_at = 100): NDKEvent {
  return evt(GROUP_METADATA_KIND, pubkey, created_at, [['name', 'Test Group']]);
}

function adminList(pubkey: string, created_at: number, entries: string[][]): NDKEvent {
  return evt(
    GROUP_ADMINS_KIND,
    pubkey,
    created_at,
    entries.map((e) => ['p', ...e])
  );
}

function memberList(
  pubkey: string,
  created_at: number,
  members: string[],
  id?: string
): NDKEvent {
  return evt(
    GROUP_MEMBERS_KIND,
    pubkey,
    created_at,
    members.map((m) => ['p', m]),
    id
  );
}

// ---------------------------------------------------------------------------
// The attack the finding describes
// ---------------------------------------------------------------------------

describe('self-published membership', () => {
  it('does not admit an attacker who publishes their own member list', () => {
    const events = [
      metadata(ALICE),
      memberList(ALICE, 200, [ALICE, CAROL]),
      // Eve publishes her own kind:39002. It is a valid, newer event, and at
      // the relay it sits beside Alice's rather than replacing it.
      memberList(EVE, 999, [ALICE, CAROL, EVE]),
    ];

    const writers = resolveTrustedWriters(GROUP, events);
    expect(writers.status).toBe('resolved');
    expect(authoritativeMembers(writers, events)).toEqual([ALICE, CAROL]);
  });

  it('does not admit an attacker who publishes their own admin list', () => {
    const events = [
      metadata(ALICE),
      adminList(ALICE, 200, [[BOB, 'add-user', 'remove-user']]),
      // Eve grants herself everything, more recently than Alice.
      adminList(EVE, 999, [
        [EVE, 'add-user', 'remove-user', 'add-permission', 'remove-permission'],
      ]),
    ];

    const writers = resolveTrustedWriters(GROUP, events);
    if (writers.status !== 'resolved') throw new Error('expected resolved');

    expect(writers.admins.map((a) => a.pubkey)).toEqual([BOB]);
    expect(writers.memberWriters.has(EVE)).toBe(false);
  });

  it('does not let an attacker-authored admin list promote them to a member writer', () => {
    const events = [
      metadata(ALICE),
      adminList(EVE, 999, [[EVE, 'add-user']]),
      memberList(ALICE, 200, [ALICE]),
      memberList(EVE, 1000, [ALICE, EVE]),
    ];

    const writers = resolveTrustedWriters(GROUP, events);
    expect(authoritativeMembers(writers, events)).toEqual([ALICE]);
  });

  it('ignores a backdated attacker event just as it ignores a future-dated one', () => {
    const events = [
      metadata(ALICE),
      memberList(ALICE, 200, [ALICE]),
      memberList(EVE, 1, [ALICE, EVE]),
      memberList(EVE, 10 ** 10, [ALICE, EVE]),
    ];

    expect(authoritativeMembers(resolveTrustedWriters(GROUP, events), events)).toEqual([ALICE]);
  });
});

// ---------------------------------------------------------------------------
// The old algorithm, kept as a fixture
// ---------------------------------------------------------------------------

/**
 * What useGroupMembers did before this change: no authors filter, merge
 * everything, latest created_at wins.
 *
 * It is reproduced here rather than described, so the tests above are
 * demonstrably about a real difference. If someone reverts the author check,
 * the assertions above fail and this one still passes — which is the point.
 */
function legacyMerge(events: NDKEvent[]): string[] {
  const seen = new Set<string>();
  for (const e of [...events].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))) {
    if (e.kind !== GROUP_MEMBERS_KIND && e.kind !== GROUP_ADMINS_KIND) continue;
    for (const t of e.tags) {
      if (t[0] === 'p' && t[1]) seen.add(t[1]);
    }
  }
  return [...seen];
}

describe('the previous behaviour', () => {
  it('admitted the attacker, which is why these tests exist', () => {
    const events = [
      metadata(ALICE),
      memberList(ALICE, 200, [ALICE, CAROL]),
      memberList(EVE, 999, [ALICE, CAROL, EVE]),
    ];

    expect(legacyMerge(events)).toContain(EVE);
    expect(authoritativeMembers(resolveTrustedWriters(GROUP, events), events)).not.toContain(EVE);
  });

  it('admitted a self-granted admin, which the owner-only rule now rejects', () => {
    const events = [
      metadata(ALICE),
      adminList(ALICE, 200, [[BOB, 'add-user']]),
      adminList(EVE, 999, [[EVE, 'add-permission', 'remove-permission']]),
    ];

    expect(legacyMerge(events)).toContain(EVE);

    const writers = resolveTrustedWriters(GROUP, events);
    if (writers.status !== 'resolved') throw new Error('expected resolved');
    expect(writers.admins.map((a) => a.pubkey)).not.toContain(EVE);
  });
});

// ---------------------------------------------------------------------------
// The product still has to work
// ---------------------------------------------------------------------------

describe('legitimate writers', () => {
  it('accepts the member list from an admin the owner granted add-user', () => {
    const events = [
      metadata(ALICE),
      adminList(ALICE, 150, [[BOB, 'add-user', 'remove-user']]),
      memberList(ALICE, 200, [ALICE]),
      memberList(BOB, 300, [ALICE, CAROL]),
    ];

    const writers = resolveTrustedWriters(GROUP, events);
    if (writers.status !== 'resolved') throw new Error('expected resolved');

    expect(writers.memberWriters.has(BOB)).toBe(true);
    expect(authoritativeMembers(writers, events)).toEqual([ALICE, CAROL]);
  });

  it('does not make an admin a member writer without add-user or remove-user', () => {
    const events = [
      metadata(ALICE),
      adminList(ALICE, 150, [[BOB, 'edit-metadata']]),
      memberList(ALICE, 200, [ALICE]),
      memberList(BOB, 300, [ALICE, BOB, EVE]),
    ];

    const writers = resolveTrustedWriters(GROUP, events);
    if (writers.status !== 'resolved') throw new Error('expected resolved');

    expect(writers.memberWriters.has(BOB)).toBe(false);
    expect(authoritativeMembers(writers, events)).toEqual([ALICE]);
  });

  it('takes the newest list among trusted writers', () => {
    const events = [
      metadata(ALICE),
      adminList(ALICE, 150, [[BOB, 'add-user']]),
      memberList(BOB, 300, [ALICE, CAROL]),
      memberList(ALICE, 400, [ALICE, CAROL, BOB]),
    ];

    expect(authoritativeMembers(resolveTrustedWriters(GROUP, events), events)).toEqual([
      ALICE,
      CAROL,
      BOB,
    ]);
  });

  it('breaks a created_at tie deterministically, so two clients agree', () => {
    const a = memberList(ALICE, 300, [ALICE], 'f'.repeat(64));
    const b = memberList(ALICE, 300, [ALICE, CAROL], '0'.repeat(64));
    const events = [metadata(ALICE), a, b];

    const forward = authoritativeMembers(resolveTrustedWriters(GROUP, events), events);
    const reversed = [...events].reverse();
    const backward = authoritativeMembers(resolveTrustedWriters(GROUP, reversed), reversed);

    expect(forward).toEqual(backward);
  });

  it('reports an empty list, not null, for a resolvable group with no member event', () => {
    const events = [metadata(ALICE)];
    expect(authoritativeMembers(resolveTrustedWriters(GROUP, events), events)).toEqual([]);
  });

  it('revoking an admin removes their member-list authority', () => {
    const events = [
      metadata(ALICE),
      adminList(ALICE, 150, [[BOB, 'add-user']]),
      adminList(ALICE, 500, []), // Alice removes Bob
      memberList(BOB, 600, [ALICE, EVE]),
      memberList(ALICE, 400, [ALICE, CAROL]),
    ];

    const writers = resolveTrustedWriters(GROUP, events);
    if (writers.status !== 'resolved') throw new Error('expected resolved');

    expect(writers.memberWriters.has(BOB)).toBe(false);
    expect(authoritativeMembers(writers, events)).toEqual([ALICE, CAROL]);
  });
});

// ---------------------------------------------------------------------------
// Legacy groups: unverifiable is a state, not an empty answer
// ---------------------------------------------------------------------------

describe('legacy identifiers', () => {
  it('reports unverifiable rather than guessing', () => {
    const events = [metadata(ALICE), memberList(EVE, 999, [EVE])];
    expect(resolveTrustedWriters(LEGACY_GROUP, events).status).toBe('unverifiable');
  });

  it('returns null members, which callers must not read as an empty group', () => {
    const events = [metadata(ALICE), memberList(ALICE, 200, [ALICE, CAROL])];
    expect(authoritativeMembers(resolveTrustedWriters(LEGACY_GROUP, events), events)).toBeNull();
  });

  it('is unverifiable when the owner has published no kind:39000 we can see', () => {
    // The prefix is in the d-tag, but with no event from a matching pubkey
    // there is no full owner pubkey to compare authors against.
    const events = [memberList(EVE, 999, [EVE])];
    expect(resolveTrustedWriters(GROUP, events).status).toBe('unverifiable');
  });
});

// ---------------------------------------------------------------------------
// Tag parsing
// ---------------------------------------------------------------------------

describe('tag parsing', () => {
  it('reads permissions from the tag positions after the pubkey', () => {
    const e = adminList(ALICE, 1, [[BOB, 'add-user', 'edit-metadata']]);
    expect(parseAdminEntries(e)).toEqual([
      { pubkey: BOB, permissions: ['add-user', 'edit-metadata'] },
    ]);
  });

  it('skips p tags with no pubkey', () => {
    const e = evt(GROUP_MEMBERS_KIND, ALICE, 1, [['p', ''], ['p', CAROL]]);
    expect(parseMemberPubkeys(e)).toEqual([CAROL]);
  });

  it('returns nothing for a null event rather than throwing', () => {
    expect(parseAdminEntries(null)).toEqual([]);
    expect(parseMemberPubkeys(null)).toEqual([]);
  });
});
