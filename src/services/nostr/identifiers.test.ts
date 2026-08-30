/**
 * @fileoverview Tests for NIP-19 identifiers.
 *
 * Two properties carry real weight here. Relay hints must survive a round trip,
 * because a share link without them resolves only for people who did not need
 * it. And an nsec must be REFUSED, loudly and by its own branch, because this
 * module's whole job is decoding whatever a user pasted.
 */

import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  decodeIdentifier,
  decodeHexAs,
  encodeProfile,
  encodeEvent,
  profilePath,
  notePath,
  abbreviate,
  SecretKeyPastedError,
} from './identifiers';

const PK = 'a'.repeat(64);
const ID = 'b'.repeat(64);
const RELAY = 'wss://relay.cloistr.xyz';

describe('decodeIdentifier', () => {
  it('decodes an npub', () => {
    expect(decodeIdentifier(nip19.npubEncode(PK))).toEqual({
      type: 'profile',
      pubkey: PK,
      relays: [],
    });
  });

  it('decodes an nprofile and keeps its relay hints', () => {
    const encoded = nip19.nprofileEncode({ pubkey: PK, relays: [RELAY] });

    expect(decodeIdentifier(encoded)).toEqual({
      type: 'profile',
      pubkey: PK,
      relays: [RELAY],
    });
  });

  it('decodes a bare note', () => {
    expect(decodeIdentifier(nip19.noteEncode(ID))).toEqual({
      type: 'event',
      id: ID,
      relays: [],
    });
  });

  it('decodes an nevent with hints and author', () => {
    const encoded = nip19.neventEncode({ id: ID, relays: [RELAY], author: PK });

    expect(decodeIdentifier(encoded)).toEqual({
      type: 'event',
      id: ID,
      relays: [RELAY],
      author: PK,
    });
  });

  it('decodes an naddr', () => {
    const encoded = nip19.naddrEncode({ kind: 30023, pubkey: PK, identifier: 'post', relays: [] });

    expect(decodeIdentifier(encoded)).toEqual({
      type: 'address',
      kind: 30023,
      pubkey: PK,
      identifier: 'post',
      relays: [],
    });
  });

  it('accepts a nostr: URI prefix', () => {
    // Links in the wild are routinely written as nostr:npub1...
    expect(decodeIdentifier(`nostr:${nip19.npubEncode(PK)}`)).toEqual({
      type: 'profile',
      pubkey: PK,
      relays: [],
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(decodeIdentifier(`  ${nip19.npubEncode(PK)}  `)?.type).toBe('profile');
  });

  it('THROWS on an nsec rather than returning null', () => {
    // The single most important behaviour in this file. Returning null would
    // let a caller fall into "unrecognised link", which is not what someone who
    // has just pasted their private key needs to be told.
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(7));

    expect(() => decodeIdentifier(nsec)).toThrow(SecretKeyPastedError);
  });

  it('throws on a MALFORMED nsec too', () => {
    // Checked by prefix before decoding, so a truncated or corrupted secret key
    // still gets the security message instead of a shrug.
    expect(() => decodeIdentifier('nsec1garbage')).toThrow(SecretKeyPastedError);
  });

  it('never puts the secret in the error message', () => {
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(9));
    try {
      decodeIdentifier(nsec);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain(nsec);
    }
  });

  it('refuses to guess what a bare hex string means', () => {
    // 64 hex chars could be a pubkey or an event id and nothing in the string
    // says which. Guessing would be wrong half the time; decodeHexAs exists for
    // callers that know from context.
    expect(decodeIdentifier(PK)).toBeNull();
  });

  it('returns null for nonsense', () => {
    expect(decodeIdentifier('hello')).toBeNull();
    expect(decodeIdentifier('')).toBeNull();
    expect(decodeIdentifier('npub1definitelynotvalid')).toBeNull();
  });
});

describe('decodeHexAs', () => {
  it('applies the context the caller has', () => {
    expect(decodeHexAs(PK, 'profile')).toEqual({ type: 'profile', pubkey: PK, relays: [] });
    expect(decodeHexAs(ID, 'event')).toEqual({ type: 'event', id: ID, relays: [] });
  });

  it('normalises case', () => {
    expect(decodeHexAs('A'.repeat(64), 'profile')).toEqual({
      type: 'profile',
      pubkey: PK,
      relays: [],
    });
  });

  it('rejects anything that is not 64 hex', () => {
    expect(decodeHexAs('abc', 'profile')).toBeNull();
    expect(decodeHexAs('z'.repeat(64), 'event')).toBeNull();
  });
});

describe('encoding', () => {
  it('emits nprofile when relays are known, npub when not', () => {
    // The distinction that makes a shared link work for someone who is not
    // already on our relay.
    expect(encodeProfile(PK, [RELAY]).startsWith('nprofile1')).toBe(true);
    expect(encodeProfile(PK).startsWith('npub1')).toBe(true);
  });

  it('emits nevent when there is anything to hint with', () => {
    expect(encodeEvent(ID, [RELAY]).startsWith('nevent1')).toBe(true);
    expect(encodeEvent(ID, [], PK).startsWith('nevent1')).toBe(true);
    expect(encodeEvent(ID).startsWith('note1')).toBe(true);
  });

  it('round-trips relay hints', () => {
    const decoded = decodeIdentifier(encodeEvent(ID, [RELAY], PK));

    expect(decoded).toEqual({ type: 'event', id: ID, relays: [RELAY], author: PK });
  });

  it('caps hints so identifiers stay a sane length', () => {
    const many = Array.from({ length: 9 }, (_, i) => `wss://r${i}.test`);
    const decoded = decodeIdentifier(encodeEvent(ID, many));

    expect(decoded?.relays).toHaveLength(3);
  });

  it('drops non-websocket relay entries', () => {
    // An https URL in a relay hint is not a relay, and shipping it would make
    // the receiving client try to open a socket to something that is not one.
    const decoded = decodeIdentifier(encodeProfile(PK, ['https://example.test', RELAY]));

    expect(decoded?.relays).toEqual([RELAY]);
  });
});

describe('routes', () => {
  it('builds resolvable paths', () => {
    expect(profilePath(PK, [RELAY])).toMatch(/^\/p\/nprofile1/);
    expect(notePath(ID, [RELAY], PK)).toMatch(/^\/e\/nevent1/);
  });

  it('produces paths its own decoder accepts', () => {
    // The round trip that actually matters: what we put in a URL must come back
    // out of the router.
    const id = profilePath(PK, [RELAY]).replace('/p/', '');

    expect(decodeIdentifier(id)).toEqual({ type: 'profile', pubkey: PK, relays: [RELAY] });
  });
});

describe('abbreviate', () => {
  it('keeps both ends so a human can compare them', () => {
    const npub = nip19.npubEncode(PK);
    const short = abbreviate(npub);

    expect(short.startsWith(npub.slice(0, 8))).toBe(true);
    expect(short.endsWith(npub.slice(-8))).toBe(true);
  });

  it('leaves short strings alone', () => {
    expect(abbreviate('short')).toBe('short');
  });
});
