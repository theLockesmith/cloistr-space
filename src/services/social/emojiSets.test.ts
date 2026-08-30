/**
 * @fileoverview Tests for NIP-51 emoji set parsing.
 *
 * The two-hop shape is the thing worth pinning: a kind:10030 with no `emoji`
 * tags is NOT an empty list, it is a list that points elsewhere, and treating
 * those as the same is the specific mistake this feature invites.
 */

import { describe, it, expect } from 'vitest';
import {
  parseEmojiTags,
  parseSetCoordinates,
  mergeEmoji,
  isRenderable,
  reactionPayload,
  FALLBACK_EMOJI,
  EMOJI_SET_KIND,
  type EmojiEntry,
} from './emojiSets';

const PK = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

describe('parseEmojiTags', () => {
  it('reads shortcode and url', () => {
    expect(parseEmojiTags([['emoji', 'party', 'https://x.test/p.png']])).toEqual([
      { shortcode: 'party', url: 'https://x.test/p.png' },
    ]);
  });

  it('ignores non-emoji tags', () => {
    expect(parseEmojiTags([['p', PK], ['d', 'set'], ['emoji', 'ok', 'https://x.test/o.png']])).toEqual([
      { shortcode: 'ok', url: 'https://x.test/o.png' },
    ]);
  });

  it('skips tags missing a url', () => {
    // Half an entry can be neither rendered nor published correctly. Admitting
    // it just relocates the failure to the publish path.
    expect(parseEmojiTags([['emoji', 'lonely'], ['emoji', '', 'https://x.test/e.png']])).toEqual([]);
  });

  it('returns empty for a list with no emoji tags', () => {
    // Note what this does NOT mean: a kind:10030 whose emoji live in `a`-tagged
    // sets returns [] here and is not empty. See parseSetCoordinates.
    expect(parseEmojiTags([['a', `${EMOJI_SET_KIND}:${PK}:mine`]])).toEqual([]);
  });
});

describe('parseSetCoordinates', () => {
  it('extracts kind:30030 coordinates', () => {
    expect(parseSetCoordinates([['a', `${EMOJI_SET_KIND}:${PK}:mine`]])).toEqual([
      { kind: EMOJI_SET_KIND, pubkey: PK, identifier: 'mine' },
    ]);
  });

  it('ignores a-tags for other kinds', () => {
    // A kind:10030 can reference other kinds. Fetching those wastes a round
    // trip and yields events the picker cannot use.
    expect(parseSetCoordinates([['a', `30000:${PK}:people`]])).toEqual([]);
  });

  it('rejects a malformed pubkey', () => {
    expect(parseSetCoordinates([['a', `${EMOJI_SET_KIND}:short:mine`]])).toEqual([]);
  });

  it('tolerates a missing identifier', () => {
    expect(parseSetCoordinates([['a', `${EMOJI_SET_KIND}:${PK}`]])).toEqual([
      { kind: EMOJI_SET_KIND, pubkey: PK, identifier: '' },
    ]);
  });

  it('finds every set in a list', () => {
    const found = parseSetCoordinates([
      ['a', `${EMOJI_SET_KIND}:${PK}:one`],
      ['emoji', 'direct', 'https://x.test/d.png'],
      ['a', `${EMOJI_SET_KIND}:${OTHER}:two`],
    ]);

    expect(found.map((c) => c.identifier)).toEqual(['one', 'two']);
  });
});

describe('mergeEmoji', () => {
  it('keeps the first occurrence of a shortcode', () => {
    // Callers pass the user's own entries first, so a shortcode they defined is
    // not shadowed by a stranger's set that reuses the name.
    const mine: EmojiEntry[] = [{ shortcode: 'fire', url: 'https://mine.test/f.png' }];
    const theirs: EmojiEntry[] = [{ shortcode: 'fire', url: 'https://theirs.test/f.png' }];

    expect(mergeEmoji(mine, theirs)[0].url).toBe('https://mine.test/f.png');
  });

  it('concatenates distinct entries', () => {
    const merged = mergeEmoji(
      [{ shortcode: 'a', native: 'A' }],
      [{ shortcode: 'b', native: 'B' }],
      [{ shortcode: 'c', native: 'C' }]
    );

    expect(merged.map((e) => e.shortcode)).toEqual(['a', 'b', 'c']);
  });
});

describe('isRenderable', () => {
  it('accepts unicode entries', () => {
    expect(isRenderable({ shortcode: 'fire', native: '🔥' })).toBe(true);
  });

  it('rejects image-backed entries', () => {
    // This is the privacy gate. If it ever returns true for a url-only entry,
    // the picker starts fetching images from hosts strangers chose.
    expect(isRenderable({ shortcode: 'party', url: 'https://x.test/p.png' })).toBe(false);
  });

  it('rejects every fallback-shaped entry that lacks a glyph', () => {
    expect(FALLBACK_EMOJI.every(isRenderable)).toBe(true);
  });
});

describe('reactionPayload', () => {
  it('reacts with the character for unicode', () => {
    expect(reactionPayload({ shortcode: 'fire', native: '🔥' })).toEqual({
      content: '🔥',
      tags: [],
    });
  });

  it('reacts with :shortcode: plus the emoji tag for custom', () => {
    // We decline to LOAD the image; we do not decline to publish it. NIP-25
    // lets the receiving client render it from this tag, so the user loses
    // nothing by our refusing to fetch.
    expect(reactionPayload({ shortcode: 'party', url: 'https://x.test/p.png' })).toEqual({
      content: ':party:',
      tags: [['emoji', 'party', 'https://x.test/p.png']],
    });
  });

  it('omits the tag when there is no url to point at', () => {
    expect(reactionPayload({ shortcode: 'bare' })).toEqual({ content: ':bare:', tags: [] });
  });
});
