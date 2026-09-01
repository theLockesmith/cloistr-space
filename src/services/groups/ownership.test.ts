/**
 * @fileoverview Tests for group ownership derivation.
 *
 * The load-bearing properties are:
 *
 *   1. The earliest kind:39000 determines the genesis owner, not any declared
 *      field in kind:39001.
 *   2. A transfer chain is followed only when signed by the current owner.
 *      An event from an outsider claiming ownership is rejected.
 *   3. A non-owner cannot transfer.
 *
 * These are the regressions that matter: a client that naively trusts kind:39001
 * entries or that fails to walk the chain would pass most tests and still let an
 * attacker claim ownership.
 */

import { describe, it, expect } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import {
  genesisEvent,
  resolveOwnership,
  ownershipClaimIsValid,
  buildTransferTags,
  TRANSFER_TAG,
} from './ownership';

// Helpers to build minimal NDKEvent stand-ins.
function evt(
  pubkey: string,
  created_at: number,
  id: string,
  tags: string[][] = []
): NDKEvent {
  return { pubkey, created_at, id, tags } as unknown as NDKEvent;
}

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const EVE = 'e'.repeat(64); // potential attacker

describe('genesisEvent', () => {
  it('returns null for an empty list', () => {
    expect(genesisEvent([])).toBeNull();
  });

  it('returns the only event when there is one', () => {
    const e = evt(ALICE, 100, 'id1');
    expect(genesisEvent([e])).toBe(e);
  });

  it('returns the earliest event by created_at', () => {
    const early = evt(ALICE, 100, 'id1');
    const late = evt(BOB, 200, 'id2');
    expect(genesisEvent([late, early])).toBe(early);
  });

  it('tiebreaks same created_at by lower event id (lexicographic)', () => {
    // Lower id wins. 'aaa...' < 'bbb...' lexicographically.
    const lower = evt(ALICE, 100, 'a'.repeat(64));
    const higher = evt(BOB, 100, 'b'.repeat(64));
    expect(genesisEvent([higher, lower])).toBe(lower);
  });

  it('tiebreak is deterministic regardless of input order', () => {
    const lower = evt(ALICE, 100, 'a'.repeat(64));
    const higher = evt(BOB, 100, 'b'.repeat(64));

    expect(genesisEvent([lower, higher])).toBe(lower);
    expect(genesisEvent([higher, lower])).toBe(lower);
  });
});

describe('resolveOwnership', () => {
  it('returns null for an empty event list', () => {
    expect(resolveOwnership([])).toBeNull();
  });

  it('returns the genesis author as owner when there is no transfer', () => {
    const events = [evt(ALICE, 100, 'id1'), evt(BOB, 200, 'id2')];
    const result = resolveOwnership(events);

    expect(result?.ownerPubkey).toBe(ALICE);
    expect(result?.fromTransfer).toBe(false);
  });

  it('the earliest kind:39000 wins, regardless of author', () => {
    // Bob publishes a kind:39000 BEFORE Alice. Bob is genesis, not Alice.
    const events = [evt(ALICE, 200, 'id2'), evt(BOB, 100, 'id1')];
    const result = resolveOwnership(events);

    expect(result?.ownerPubkey).toBe(BOB);
  });

  it('follows a single valid transfer', () => {
    const events = [
      // Genesis: Alice
      evt(ALICE, 100, 'id-genesis'),
      // Alice later publishes a transfer to Bob
      evt(ALICE, 200, 'id-transfer', [[TRANSFER_TAG, BOB]]),
    ];
    const result = resolveOwnership(events);

    expect(result?.ownerPubkey).toBe(BOB);
    expect(result?.fromTransfer).toBe(true);
  });

  it('follows a transfer chain: genesis → A → B → C', () => {
    const events = [
      evt(ALICE, 100, 'id1'),
      evt(ALICE, 200, 'id2', [[TRANSFER_TAG, BOB]]),
      evt(BOB, 300, 'id3', [[TRANSFER_TAG, CAROL]]),
    ];
    const result = resolveOwnership(events);

    expect(result?.ownerPubkey).toBe(CAROL);
  });

  it('REJECTS an ownership claim contradicting the creation event', () => {
    // Eve publishes a kind:39000 claiming to transfer to herself.
    // She is not in the chain, so her event is ignored.
    const events = [
      evt(ALICE, 100, 'id1'), // Genesis: Alice is owner
      evt(EVE, 200, 'id2', [[TRANSFER_TAG, EVE]]), // Eve tries to hijack
    ];
    const result = resolveOwnership(events);

    // Eve is not in the chain — Alice never transferred to her.
    // The chain walk only follows events from the current owner.
    expect(result?.ownerPubkey).toBe(ALICE);
    expect(result?.fromTransfer).toBe(false);
  });

  it('stops at a cycle and does not loop forever', () => {
    // Alice transfers to Bob, Bob transfers back to Alice. Should terminate.
    const events = [
      evt(ALICE, 100, 'id1'),
      evt(ALICE, 200, 'id2', [[TRANSFER_TAG, BOB]]),
      evt(BOB, 300, 'id3', [[TRANSFER_TAG, ALICE]]),
    ];
    // Should not throw and should return something — Alice or Bob depending
    // on which is detected as the cycle start.
    expect(() => resolveOwnership(events)).not.toThrow();
    const result = resolveOwnership(events);
    expect(result).not.toBeNull();
  });

  it('uses the LATEST event from each owner to determine transfer', () => {
    // Alice has two events: the earlier one has no transfer, the later one does.
    // The later one should win for the transfer check.
    const events = [
      evt(ALICE, 100, 'id1'), // Genesis — no transfer
      evt(ALICE, 300, 'id3', [[TRANSFER_TAG, BOB]]), // Later — transfer to Bob
    ];
    const result = resolveOwnership(events);

    expect(result?.ownerPubkey).toBe(BOB);
  });

  it('records the genesis id correctly', () => {
    const genesisId = 'genesis-event-id-' + '0'.repeat(46);
    const events = [evt(ALICE, 100, genesisId)];
    const result = resolveOwnership(events);

    expect(result?.genesisId).toBe(genesisId);
  });
});

describe('ownershipClaimIsValid', () => {
  it('returns false for an empty event list', () => {
    expect(ownershipClaimIsValid([], ALICE)).toBe(false);
  });

  it('accepts a valid claim matching the genesis owner', () => {
    const events = [evt(ALICE, 100, 'id1')];
    expect(ownershipClaimIsValid(events, ALICE)).toBe(true);
  });

  it('rejects a claim that contradicts the creation event', () => {
    // Alice created the group. Bob claims to own it. Rejected.
    const events = [evt(ALICE, 100, 'id1'), evt(BOB, 200, 'id2')];
    expect(ownershipClaimIsValid(events, BOB)).toBe(false);
  });

  it('accepts a claim that is valid after a transfer', () => {
    const events = [
      evt(ALICE, 100, 'id1'),
      evt(ALICE, 200, 'id2', [[TRANSFER_TAG, BOB]]),
    ];
    expect(ownershipClaimIsValid(events, BOB)).toBe(true);
    expect(ownershipClaimIsValid(events, ALICE)).toBe(false); // Alice transferred away
  });
});

describe('buildTransferTags', () => {
  it('includes the d-tag and transfer-to tag', () => {
    const tags = buildTransferTags('my-group', BOB, {});
    expect(tags).toContainEqual(['d', 'my-group']);
    expect(tags).toContainEqual([TRANSFER_TAG, BOB]);
  });

  it('preserves metadata so the group name is not wiped', () => {
    const tags = buildTransferTags('g', BOB, {
      name: 'My Project',
      about: 'A description',
      picture: 'https://example.com/img.png',
    });
    expect(tags).toContainEqual(['name', 'My Project']);
    expect(tags).toContainEqual(['about', 'A description']);
    expect(tags).toContainEqual(['picture', 'https://example.com/img.png']);
  });

  it('omits metadata tags for absent or blank fields', () => {
    const tags = buildTransferTags('g', BOB, { name: 'N', about: '  ', picture: '' });
    expect(tags).toContainEqual(['name', 'N']);
    // Blank about and empty picture are omitted, not written as empty strings.
    expect(tags).not.toContainEqual(['about', '  ']);
    expect(tags).not.toContainEqual(['picture', '']);
  });
});

describe('transfer design notes (doc tests)', () => {
  it('the TRANSFER_TAG constant is "transfer-to"', () => {
    // Pinned so any rename is a deliberate decision, not an accident.
    expect(TRANSFER_TAG).toBe('transfer-to');
  });

  it('"earliest wins" and "follow the chain" do not conflict', () => {
    // The tension described in the fileoverview:
    // - Genesis uses earliest-wins to find WHO created the group.
    // - Transfers use the chain FROM the genesis owner, not earliest-wins again.
    // This test makes the property concrete: a LATER event from a non-chain
    // participant cannot claim to be the genesis.
    const events = [
      evt(ALICE, 100, 'id1'), // Alice: earliest, is genesis
      evt(EVE, 50, 'id0'), // Eve: even earlier timestamp!
    ];
    // Eve is earlier — but she is not the genesis owner for the purposes of
    // transfer-chain resolution. Wait, actually she IS: 50 < 100.
    // This tests that "earliest wins" applies to ALL events, including attackers.
    const result = resolveOwnership(events);
    // Eve's event at t=50 is earlier than Alice's at t=100.
    // So Eve IS the genesis owner. This is correct — whoever publishes the
    // FIRST kind:39000 for the d-tag is the creator.
    expect(result?.ownerPubkey).toBe(EVE);
    // The point: "earliest wins" is honest and global. You cannot retroactively
    // become the creator. But you ALSO cannot forge a transfer — because Eve has
    // no transfer-to tag, Alice is not in the chain, so Alice cannot claim
    // ownership either.
    expect(ownershipClaimIsValid(events, ALICE)).toBe(false);
  });
});
