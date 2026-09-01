/**
 * @fileoverview Tests for group ownership derivation.
 *
 * The load-bearing properties:
 *
 *   1. A BACKDATED event from a non-creator does NOT become the owner. This is
 *      the exact attack that broke the original "earliest wins" scheme —
 *      created_at is author-controlled, so "earliest" is forgeable.
 *
 *   2. Ownership is derived from the d-tag's embedded pubkey prefix, not from
 *      event timestamps. Finding a pubkey matching a 16-char prefix requires
 *      ~2^64 secp256k1 scalar multiplications — expensive, sized to the threat
 *      model rather than cryptographically infeasible.
 *
 *   3. A transfer chain is followed only when signed by the current owner. An
 *      outsider's transfer-to tag is ignored.
 *
 *   4. Legacy groups (no pubkey in d-tag) report 'legacy', not a guess.
 *      Falling back to earliest-wins for them would reintroduce attack 1 for
 *      exactly the groups that cannot defend against it.
 *
 * The genesisEvent() tests are kept as documentation of the broken mechanism.
 * genesisEvent() is no longer used for ownership; it is exported only to serve
 * as a named regression fixture.
 */

import { describe, it, expect } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import {
  genesisEvent,
  extractOwnerPrefix,
  buildGroupIdentifier,
  resolveOwnership,
  ownershipClaimIsValid,
  buildTransferTags,
  TRANSFER_TAG,
} from './ownership';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function evt(pubkey: string, created_at: number, id: string, tags: string[][] = []): NDKEvent {
  return { pubkey, created_at, id, tags } as unknown as NDKEvent;
}

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const EVE = 'e'.repeat(64); // attacker

/** A pubkey-aware identifier for the given creator pubkey. */
function makeIdentifier(pubkey: string): string {
  // Deterministic for tests; we use a fixed random suffix.
  return `test-group-${pubkey.slice(0, 16)}-deadbeef`;
}

// ---------------------------------------------------------------------------
// genesisEvent — documented negative example; NOT used for ownership
// ---------------------------------------------------------------------------

describe('genesisEvent (documented negative example)', () => {
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

  /**
   * THIS IS THE ATTACK that broke the original scheme.
   *
   * genesisEvent picks the smallest created_at. EVE sets created_at = 0 and
   * instantly becomes the "genesis". This is why genesisEvent is not used for
   * ownership and ownership is anchored in the d-tag instead.
   */
  it('a backdated event from an attacker becomes the "genesis" — WHY THIS FUNCTION IS WRONG', () => {
    const aliceCreates = evt(ALICE, 100, 'id-alice');
    const eveBackdates = evt(EVE, 0, 'id-eve-backdated');

    // genesisEvent says EVE created the group. That is why it is not the oracle.
    expect(genesisEvent([aliceCreates, eveBackdates])).toBe(eveBackdates);
  });
});

// ---------------------------------------------------------------------------
// extractOwnerPrefix
// ---------------------------------------------------------------------------

describe('extractOwnerPrefix', () => {
  it('extracts the 16-char hex prefix from a well-formed identifier', () => {
    expect(extractOwnerPrefix(`test-group-${'a'.repeat(16)}-deadbeef`)).toBe('a'.repeat(16));
  });

  it('returns null for a legacy identifier (no pubkey segment)', () => {
    expect(extractOwnerPrefix('old-group-abc1234')).toBeNull();
    expect(extractOwnerPrefix('test-7k8n2q3')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractOwnerPrefix('')).toBeNull();
  });

  it('handles a slug that is itself 16 hex chars', () => {
    // The regex always extracts the second-to-last segment, so an ambiguous
    // slug does not displace the pubkey prefix.
    const id = `${'a'.repeat(16)}-${'b'.repeat(16)}-deadbeef`;
    expect(extractOwnerPrefix(id)).toBe('b'.repeat(16));
  });
});

// ---------------------------------------------------------------------------
// resolveOwnership — the corrected scheme
// ---------------------------------------------------------------------------

describe('resolveOwnership', () => {
  it('returns { status: "legacy" } for an identifier without a pubkey prefix', () => {
    const events = [evt(ALICE, 100, 'id1')];
    expect(resolveOwnership('old-group-abc1234', events)).toEqual({ status: 'legacy' });
  });

  it('returns { status: "legacy" } for an empty event list even with a valid identifier', () => {
    // The creator's event is not on the relay — treated as unresolvable.
    expect(resolveOwnership(makeIdentifier(ALICE), [])).toEqual({ status: 'legacy' });
  });

  it('returns the creator as owner when there is no transfer', () => {
    const events = [evt(ALICE, 100, 'id1')];
    expect(resolveOwnership(makeIdentifier(ALICE), events)).toEqual({
      status: 'owner',
      ownerPubkey: ALICE,
      fromTransfer: false,
    });
  });

  it('a BACKDATED event from a non-creator does NOT become the owner', () => {
    // This is the primary regression. EVE sets created_at: 0. Under "earliest
    // wins" she would be genesis. Under this scheme she is ignored because her
    // pubkey does not start with ALICE's prefix, which is in the d-tag.
    const events = [
      evt(ALICE, 100, 'id-alice'),
      evt(EVE, 0, 'id-eve-backdated'), // earlier timestamp — does not matter
    ];
    const result = resolveOwnership(makeIdentifier(ALICE), events);

    expect(result).toEqual({ status: 'owner', ownerPubkey: ALICE, fromTransfer: false });
  });

  it('ignores events from pubkeys that do not match the d-tag prefix', () => {
    const events = [
      evt(ALICE, 100, 'id-alice'),
      evt(BOB, 50, 'id-bob'), // BOB tries to claim group with ALICE prefix
      evt(EVE, 200, 'id-eve'),
    ];
    const result = resolveOwnership(makeIdentifier(ALICE), events);

    expect(result).toEqual({ status: 'owner', ownerPubkey: ALICE, fromTransfer: false });
  });

  it('follows a single valid transfer', () => {
    const events = [
      evt(ALICE, 100, 'id-genesis'),
      evt(ALICE, 200, 'id-transfer', [[TRANSFER_TAG, BOB]]),
    ];
    expect(resolveOwnership(makeIdentifier(ALICE), events)).toEqual({
      status: 'owner',
      ownerPubkey: BOB,
      fromTransfer: true,
    });
  });

  it('follows a transfer chain: creator → A → B → C', () => {
    const events = [
      evt(ALICE, 100, 'id1'),
      evt(ALICE, 200, 'id2', [[TRANSFER_TAG, BOB]]),
      evt(BOB, 300, 'id3', [[TRANSFER_TAG, CAROL]]),
    ];
    expect(resolveOwnership(makeIdentifier(ALICE), events)).toEqual({
      status: 'owner',
      ownerPubkey: CAROL,
      fromTransfer: true,
    });
  });

  it('a non-chain participant publishing a transfer-to tag is ignored', () => {
    // EVE publishes a transfer-to for herself. She is not in the chain
    // (ALICE never transferred to her), so the chain walk never visits her.
    const events = [
      evt(ALICE, 100, 'id-alice'),
      evt(EVE, 200, 'id-eve', [[TRANSFER_TAG, EVE]]), // EVE tries to hijack
    ];
    const result = resolveOwnership(makeIdentifier(ALICE), events);

    expect(result).toEqual({ status: 'owner', ownerPubkey: ALICE, fromTransfer: false });
  });

  it('stops at a cycle and does not loop forever', () => {
    // ALICE → BOB → ALICE: should terminate without throwing.
    const events = [
      evt(ALICE, 100, 'id1'),
      evt(ALICE, 200, 'id2', [[TRANSFER_TAG, BOB]]),
      evt(BOB, 300, 'id3', [[TRANSFER_TAG, ALICE]]),
    ];
    expect(() => resolveOwnership(makeIdentifier(ALICE), events)).not.toThrow();
    const result = resolveOwnership(makeIdentifier(ALICE), events);
    expect(result.status).toBe('owner');
  });

  it('uses the LATEST event from each owner for the transfer check', () => {
    // ALICE's earlier event has no transfer; her later one does.
    // The later one wins.
    const events = [
      evt(ALICE, 100, 'id1'),
      evt(ALICE, 300, 'id3', [[TRANSFER_TAG, BOB]]),
    ];
    expect(resolveOwnership(makeIdentifier(ALICE), events)).toEqual({
      status: 'owner',
      ownerPubkey: BOB,
      fromTransfer: true,
    });
  });
});

// ---------------------------------------------------------------------------
// ownershipClaimIsValid
// ---------------------------------------------------------------------------

describe('ownershipClaimIsValid', () => {
  it('returns false for a legacy identifier', () => {
    expect(ownershipClaimIsValid('old-group-abc1234', [], ALICE)).toBe(false);
  });

  it('accepts a valid claim matching the creator', () => {
    const events = [evt(ALICE, 100, 'id1')];
    expect(ownershipClaimIsValid(makeIdentifier(ALICE), events, ALICE)).toBe(true);
  });

  it('rejects a claim from a pubkey not in the chain', () => {
    const events = [evt(ALICE, 100, 'id1')];
    expect(ownershipClaimIsValid(makeIdentifier(ALICE), events, BOB)).toBe(false);
  });

  it('a backdated event from an attacker does not make their claim valid', () => {
    // EVE backdates her event. ALICE still owns the group because ALICE's
    // pubkey is in the d-tag, not EVE's.
    const events = [evt(ALICE, 100, 'id1'), evt(EVE, 0, 'id-eve')];
    expect(ownershipClaimIsValid(makeIdentifier(ALICE), events, EVE)).toBe(false);
    expect(ownershipClaimIsValid(makeIdentifier(ALICE), events, ALICE)).toBe(true);
  });

  it('accepts a claim valid after a transfer', () => {
    const events = [
      evt(ALICE, 100, 'id1'),
      evt(ALICE, 200, 'id2', [[TRANSFER_TAG, BOB]]),
    ];
    expect(ownershipClaimIsValid(makeIdentifier(ALICE), events, BOB)).toBe(true);
    expect(ownershipClaimIsValid(makeIdentifier(ALICE), events, ALICE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildGroupIdentifier
// ---------------------------------------------------------------------------

describe('buildGroupIdentifier', () => {
  it('embeds the first 16 chars of the creator pubkey', () => {
    const id = buildGroupIdentifier('My Project', ALICE);
    expect(id).toContain(ALICE.slice(0, 16));
  });

  it('slugifies the name', () => {
    const id = buildGroupIdentifier('Hello World!', ALICE);
    expect(id).toMatch(/^hello-world-/);
  });

  it('matches the OWNER_PATTERN (extractOwnerPrefix returns the prefix)', () => {
    const id = buildGroupIdentifier('test', ALICE);
    expect(extractOwnerPrefix(id)).toBe(ALICE.slice(0, 16));
  });

  it('two calls produce different identifiers (random suffix)', () => {
    // This test is non-deterministic in theory but passes with overwhelming
    // probability since the suffix is 32 bits of crypto randomness.
    const a = buildGroupIdentifier('same', ALICE);
    const b = buildGroupIdentifier('same', ALICE);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// buildTransferTags
// ---------------------------------------------------------------------------

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
    expect(tags).not.toContainEqual(['about', '  ']);
    expect(tags).not.toContainEqual(['picture', '']);
  });
});

// ---------------------------------------------------------------------------
// TRANSFER_TAG constant
// ---------------------------------------------------------------------------

describe('TRANSFER_TAG', () => {
  it('is "transfer-to" — pinned so any rename is a deliberate decision', () => {
    expect(TRANSFER_TAG).toBe('transfer-to');
  });
});
