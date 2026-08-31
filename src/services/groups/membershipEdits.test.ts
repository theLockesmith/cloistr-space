/**
 * @fileoverview Tests for safe member-list edits.
 *
 * kind:39002 is ADDRESSABLE: a replacement carrying only the new member removes
 * everyone else, and it looks like it worked. The same shape destroyed a
 * contact list in this codebase already, so these are the tests that stop it
 * happening to a group.
 *
 * Our relay does not run relay29 (GROUPS_ENABLED absent from the pod), so
 * nothing processes a kind:9000 and the CLIENT is authoritative. There is no
 * server-side check behind these guards -- they are the only thing between a
 * failed read and a deleted group.
 */

import { describe, it, expect } from 'vitest';
import {
  membersAfterAdd,
  membersAfterRemove,
  buildMemberTags,
  REFUSAL_MESSAGE,
} from './membershipEdits';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

describe('membersAfterAdd', () => {
  it('appends to the FULL existing list', () => {
    // The whole point: the published event must carry everyone, not the delta.
    const result = membersAfterAdd({ ok: true, members: [A, B] }, C);

    expect(result).toEqual({ ok: true, members: [A, B, C] });
  });

  it('REFUSES when the read failed', () => {
    // THE guard. Publishing here would replace a populated group with a
    // one-member list, and the UI would report success.
    const result = membersAfterAdd({ ok: false, members: [] }, C);

    expect(result).toEqual({ ok: false, reason: 'read-failed' });
  });

  it('refuses a failed read even when it returned members', () => {
    // A partial read is not a safe basis for a wholesale replacement. `ok` is a
    // separate field precisely so this case cannot be inferred from the array.
    const result = membersAfterAdd({ ok: false, members: [A] }, C);

    expect(result).toEqual({ ok: false, reason: 'read-failed' });
  });

  it('does not duplicate an existing member', () => {
    expect(membersAfterAdd({ ok: true, members: [A, B] }, B)).toEqual({
      ok: false,
      reason: 'no-change',
    });
  });

  it('matches case-insensitively when deduping', () => {
    expect(membersAfterAdd({ ok: true, members: [A.toUpperCase()] }, A)).toEqual({
      ok: false,
      reason: 'no-change',
    });
  });

  it('rejects anything that is not a 64-char hex pubkey', () => {
    // An npub pasted into the box, or a typo, must not become a p tag.
    expect(membersAfterAdd({ ok: true, members: [A] }, 'npub1whatever').ok).toBe(false);
    expect(membersAfterAdd({ ok: true, members: [A] }, '').ok).toBe(false);
  });

  it('adds to an empty but successfully-read group', () => {
    // ok:true with no members is a real, safe state -- a group with nobody in
    // it yet. This is exactly the case the `ok` flag exists to distinguish.
    expect(membersAfterAdd({ ok: true, members: [] }, A)).toEqual({ ok: true, members: [A] });
  });
});

describe('membersAfterRemove', () => {
  it('removes one and keeps the rest', () => {
    expect(membersAfterRemove({ ok: true, members: [A, B, C] }, B)).toEqual({
      ok: true,
      members: [A, C],
    });
  });

  it('REFUSES when the read failed', () => {
    expect(membersAfterRemove({ ok: false, members: [] }, A)).toEqual({
      ok: false,
      reason: 'read-failed',
    });
  });

  it('refuses to empty the group', () => {
    // Removing the last member is indistinguishable from a bug that computed an
    // empty set, and the cost of being wrong is the group. Same reasoning as
    // the emptiness guard in publishContacts.
    expect(membersAfterRemove({ ok: true, members: [A] }, A)).toEqual({
      ok: false,
      reason: 'would-empty',
    });
  });

  it('reports no-change for someone who was never a member', () => {
    expect(membersAfterRemove({ ok: true, members: [A, B] }, C)).toEqual({
      ok: false,
      reason: 'no-change',
    });
  });
});

describe('buildMemberTags', () => {
  it('carries the group id and every member', () => {
    expect(buildMemberTags('team', [A, B])).toEqual([
      ['d', 'team'],
      ['p', A],
      ['p', B],
    ]);
  });
});

describe('REFUSAL_MESSAGE', () => {
  it('has wording for every refusal', () => {
    // A refusal with no message renders an empty explanation, and a silent
    // refusal is indistinguishable from a silent failure.
    for (const reason of ['read-failed', 'would-empty', 'no-change'] as const) {
      expect(REFUSAL_MESSAGE[reason]).toBeTruthy();
    }
  });

  it('explains the read-failure consequence rather than just stating it', () => {
    expect(REFUSAL_MESSAGE['read-failed']).toMatch(/removed everyone/i);
  });
});
