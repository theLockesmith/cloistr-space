/**
 * @fileoverview Tests for contact-list recovery selection.
 *
 * This decides whether to overwrite the user's current contact list with an
 * older one. Getting it wrong in the permissive direction destroys exactly what
 * the feature exists to restore, so the "do not recover" cases carry more
 * weight here than the happy path.
 */

import { describe, it, expect } from 'vitest';
import { selectRecoveryCandidate, type ParsedContactEvent } from './recovery';
import type { ContactsCrdtState, ContactEntry } from '@/types/contacts';

function state(entries: Array<[string, Partial<ContactEntry>]>): ContactsCrdtState {
  const map = new Map<string, ContactEntry>();
  for (const [pubkey, over] of entries) {
    map.set(pubkey, {
      pubkey,
      timestamp: 1000,
      deleted: false,
      ...over,
    } as ContactEntry);
  }
  return { entries: map } as ContactsCrdtState;
}

function ev(createdAt: number, s: ContactsCrdtState): ParsedContactEvent {
  return { createdAt, state: s };
}

describe('selectRecoveryCandidate', () => {
  it('recovers the older populated list when the current one is contentless', () => {
    // The operator's exact situation: a real list from 2026-08-02 superseded by
    // a tagless one from 2026-08-24.
    const candidate = selectRecoveryCandidate([
      ev(1785708375, state([['alice', {}], ['bob', {}]])),
      ev(1787573449, state([])),
    ]);

    expect(candidate).not.toBeNull();
    expect(candidate!.contactCount).toBe(2);
    expect(candidate!.restoredFrom).toBe(1785708375);
  });

  it('does NOT recover when the current list has contacts', () => {
    // Restoring over a real list would undo every follow made since -- the same
    // destruction this exists to repair, pointed the other way.
    const candidate = selectRecoveryCandidate([
      ev(100, state([['alice', {}], ['bob', {}], ['carol', {}]])),
      ev(200, state([['alice', {}]])),
    ]);

    expect(candidate).toBeNull();
  });

  it('does NOT recover when the current list holds only tombstones', () => {
    // Someone who unfollowed everyone made a deliberate statement. The entries
    // are all deleted, so live count is zero, but the list is not contentless
    // and must be left alone.
    const candidate = selectRecoveryCandidate([
      ev(100, state([['alice', {}], ['bob', {}]])),
      ev(200, state([['alice', { deleted: true }], ['bob', { deleted: true }]])),
    ]);

    expect(candidate).toBeNull();
  });

  it('prefers the FULLEST older list, not the most recent one', () => {
    // Space may have published more than one empty or partial list before
    // anyone noticed. Newest-non-empty would restore a truncated intermediate
    // over the complete list sitting behind it.
    const candidate = selectRecoveryCandidate([
      ev(100, state([['a', {}], ['b', {}], ['c', {}], ['d', {}]])),
      ev(200, state([['a', {}]])),
      ev(300, state([])),
    ]);

    expect(candidate!.contactCount).toBe(4);
    expect(candidate!.restoredFrom).toBe(100);
  });

  it('ignores tombstones when measuring how much a candidate restores', () => {
    // A candidate whose entries are mostly deletions is not a fuller list.
    const candidate = selectRecoveryCandidate([
      ev(100, state([['a', {}], ['b', {}]])),
      ev(150, state([['a', { deleted: true }], ['b', { deleted: true }], ['c', { deleted: true }]])),
      ev(300, state([])),
    ]);

    expect(candidate!.contactCount).toBe(2);
    expect(candidate!.restoredFrom).toBe(100);
  });

  it('returns null when there is only the empty current event', () => {
    // Relay dropped the superseded version, which it is entitled to do. Normal
    // outcome, not an error -- the caller falls back to kind:3.
    expect(selectRecoveryCandidate([ev(300, state([]))])).toBeNull();
  });

  it('returns null when every older event is also empty', () => {
    expect(
      selectRecoveryCandidate([ev(100, state([])), ev(200, state([])), ev(300, state([]))])
    ).toBeNull();
  });

  it('returns null for no events at all', () => {
    expect(selectRecoveryCandidate([])).toBeNull();
  });
});
