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
import { nip19 } from 'nostr-tools';
import {
  membersAfterAdd,
  normalizePubkey,
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

describe('normalizePubkey', () => {
  const HEX = 'a'.repeat(64);

  it('accepts an npub, which is the only form anyone actually has', () => {
    // THE bug. Every Nostr UI shows npub; nobody has hex to hand. Pasting the
    // one identifier you possess fell through to 'no-change' and the UI said
    // "Nothing to change" -- asserting the input was understood.
    const npub = nip19.npubEncode(HEX);

    expect(normalizePubkey(npub)).toEqual({ ok: true, pubkey: HEX });
  });

  it('accepts an nprofile', () => {
    const nprofile = nip19.nprofileEncode({ pubkey: HEX, relays: ['wss://r.test'] });

    expect(normalizePubkey(nprofile)).toEqual({ ok: true, pubkey: HEX });
  });

  it('accepts hex, in either case', () => {
    expect(normalizePubkey(HEX.toUpperCase())).toEqual({ ok: true, pubkey: HEX });
  });

  it('tolerates whitespace and a nostr: prefix, because these are pasted', () => {
    expect(normalizePubkey(`  nostr:${nip19.npubEncode(HEX)}  `)).toEqual({
      ok: true,
      pubkey: HEX,
    });
  });

  it('reports unreadable input as UNREADABLE, not as no-change', () => {
    // The generalisable half. "Already a member" and "I could not read that"
    // are different facts, and only the first is a no-change.
    expect(normalizePubkey('hello')).toEqual({ ok: false, reason: 'unreadable' });
    expect(normalizePubkey('')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('reports an nsec as its own refusal, loudly', () => {
    // Somebody pasting a private key into a member field needs telling. It must
    // not surface as "unreadable", and it must not throw.
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(3));

    expect(normalizePubkey(nsec)).toEqual({ ok: false, reason: 'secret-key' });
  });

  it('never echoes the secret back in its message', () => {
    expect(REFUSAL_MESSAGE['secret-key']).not.toMatch(/nsec1[a-z0-9]{10}/);
    expect(REFUSAL_MESSAGE['secret-key']).toMatch(/rotate/i);
  });
});

describe('membersAfterAdd with real-world input', () => {
  const HEX = 'a'.repeat(64);

  it('adds a member pasted as an npub', () => {
    const result = membersAfterAdd({ ok: true, members: [] }, nip19.npubEncode(HEX));

    expect(result).toEqual({ ok: true, members: [HEX] });
  });

  it('still dedups when the same person is given in the other encoding', () => {
    // Hex already present, npub pasted. Without normalising before the
    // comparison this would add a duplicate p tag for one person.
    const result = membersAfterAdd({ ok: true, members: [HEX] }, nip19.npubEncode(HEX));

    expect(result).toEqual({ ok: false, reason: 'no-change' });
  });

  it('distinguishes unreadable input from an existing member', () => {
    expect(membersAfterAdd({ ok: true, members: [HEX] }, 'not a key')).toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });
});
