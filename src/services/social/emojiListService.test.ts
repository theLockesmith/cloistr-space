/**
 * @fileoverview Tests for kind:10030 editing.
 *
 * The thing worth pinning down hardest: a read failure must never reach a
 * publish. See CLAUDE.md failure pattern #4 -- an addressable replacement
 * carrying only the new entry wipes everything else, and the group-membership
 * code this module copies its shape from exists because that already
 * happened once.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Event, UnsignedEvent } from 'nostr-tools';
import type { SignerInterface, RelayClient } from '../headless';
import { EMOJI_LIST_KIND, EMOJI_NATIVE_TAG } from './emojiSets';
import {
  readEmojiList,
  listAfterAddUnicode,
  listAfterAddCustom,
  listAfterRemove,
  listAfterMove,
  addUnicodeEmoji,
  addCustomEmoji,
  removeEmojiEntry,
  moveEmojiEntry,
  splitManagedTags,
  type ListRead,
} from './emojiListService';

const PK = 'a'.repeat(64);

function createMockSigner(pubkey = PK): SignerInterface {
  return {
    getPublicKey: async () => pubkey,
    signEvent: async (unsigned: UnsignedEvent): Promise<Event> => ({
      ...unsigned,
      id: 'b'.repeat(64),
      sig: 'c'.repeat(128),
    }),
    encrypt: async () => '',
    decrypt: async () => '',
  };
}

function createMockRelay(events: Event[] = []): RelayClient & { published: Event[] } {
  const published: Event[] = [];
  return {
    published,
    publish: async (event: Event) => {
      published.push(event);
      return 1;
    },
    fetch: async () => events,
    read: async () => ({ events, answeredBy: 1 }),
  };
}

function fakeEvent(tags: string[][], createdAt: number): Event {
  return {
    id: 'e'.repeat(64),
    pubkey: PK,
    created_at: createdAt,
    kind: EMOJI_LIST_KIND,
    content: '',
    tags,
    sig: 'd'.repeat(128),
  };
}

const SOME_SET_POINTER: string[][] = [['a', `30030:${'f'.repeat(64)}:party-pack`]];
const UNKNOWN_FUTURE_TAG: string[][] = [['future_thing', 'nobody knows what this means yet']];
const MALFORMED_EMOJI_TAG: string[][] = [['emoji', 'lonely']]; // no url -- not well-formed

describe('readEmojiList', () => {
  it('distinguishes "no list exists" from "read failed"', async () => {
    const emptyRelay = createMockRelay([]);
    const noList = await readEmojiList(emptyRelay, PK);
    expect(noList).toEqual({ ok: true, exists: false, tags: [] });

    const brokenRelay: RelayClient = {
      publish: async () => 0,
      fetch: async () => {
        throw new Error('relay unreachable');
      },
    };
    const failedRead = await readEmojiList(brokenRelay, PK);
    expect(failedRead.ok).toBe(false);
    // A failed read must not be reported as an empty-but-valid list -- the
    // caller needs to refuse to publish, not publish an empty list.
    expect(failedRead).not.toEqual(noList);
  });

  it('treats "no relay answered" as a failed read, not as "no list exists"', async () => {
    // fetchFromOwnRelays resolves EMPTY when nobody answered; only the
    // answered-by count tells that apart from a real empty result.
    const silent: RelayClient = {
      publish: vi.fn(async () => 1),
      fetch: async () => [],
      read: async () => ({ events: [], answeredBy: 0 }),
    };
    expect((await readEmojiList(silent, PK)).ok).toBe(false);

    await expect(addUnicodeEmoji(createMockSigner(), silent, '🔥', 'fire')).rejects.toThrow(
      /Could not read your current emoji list/,
    );
    expect(silent.publish).not.toHaveBeenCalled();
  });

  it('treats a read that timed out as failed', async () => {
    const timedOut: RelayClient = {
      publish: async () => 1,
      fetch: async () => [],
      read: async () => {
        throw new Error('None of your relays answered.');
      },
    };
    expect((await readEmojiList(timedOut, PK)).ok).toBe(false);
  });

  it('refuses to trust a relay client that cannot say whether anyone answered', async () => {
    const blind: RelayClient = { publish: async () => 1, fetch: async () => [] };
    expect((await readEmojiList(blind, PK)).ok).toBe(false);
  });

  it('picks the newest event by created_at, not the first or last returned', async () => {
    const older = fakeEvent([['emoji', 'old', 'https://old.test/o.png']], 100);
    const newer = fakeEvent([['emoji', 'new', 'https://new.test/n.png']], 200);
    // Deliberately returned newest-first, to prove this isn't "take events[0]".
    const relay = createMockRelay([newer, older]);

    const read = await readEmojiList(relay, PK);
    expect(read).toEqual({ ok: true, exists: true, tags: newer.tags });
  });
});

describe('splitManagedTags', () => {
  it('treats a-pointers, unknown tags, and malformed emoji tags as "other"', () => {
    const { entries, other } = splitManagedTags([
      ['emoji', 'party', 'https://x.test/p.png'],
      ...SOME_SET_POINTER,
      ...UNKNOWN_FUTURE_TAG,
      ...MALFORMED_EMOJI_TAG,
    ]);

    expect(entries).toEqual([['emoji', 'party', 'https://x.test/p.png']]);
    expect(other).toEqual([...SOME_SET_POINTER, ...UNKNOWN_FUTURE_TAG, ...MALFORMED_EMOJI_TAG]);
  });
});

describe('listAfterAddUnicode / listAfterAddCustom', () => {
  const read: ListRead = { ok: true, exists: true, tags: [] };

  it('adds a unicode favourite as an emoji_native tag', () => {
    const result = listAfterAddUnicode(read, '🔥', 'fire');
    expect(result).toEqual({ ok: true, tags: [[EMOJI_NATIVE_TAG, 'fire', '🔥']] });
  });

  it('adds a custom emoji as an emoji tag, requiring https', () => {
    const ok = listAfterAddCustom(read, 'party', 'https://x.test/p.png');
    expect(ok).toEqual({ ok: true, tags: [['emoji', 'party', 'https://x.test/p.png']] });

    const insecure = listAfterAddCustom(read, 'party', 'http://x.test/p.png');
    expect(insecure).toEqual({ ok: false, reason: 'invalid-url' });
  });

  it('rejects a shortcode with characters outside [a-zA-Z0-9_]', () => {
    expect(listAfterAddUnicode(read, '🔥', 'fire!').ok).toBe(false);
    expect(listAfterAddCustom(read, 'par ty', 'https://x.test/p.png').ok).toBe(false);
  });

  it('rejects a duplicate shortcode rather than writing two tags', () => {
    const withFire: ListRead = { ok: true, exists: true, tags: [[EMOJI_NATIVE_TAG, 'fire', '🔥']] };
    expect(listAfterAddUnicode(withFire, '🔥', 'fire')).toEqual({ ok: false, reason: 'duplicate-shortcode' });
    expect(listAfterAddCustom(withFire, 'fire', 'https://x.test/f.png')).toEqual({
      ok: false,
      reason: 'duplicate-shortcode',
    });
  });

  it('refuses an empty native character', () => {
    expect(listAfterAddUnicode(read, '   ', 'blank')).toEqual({ ok: false, reason: 'invalid-native' });
  });

  it('THE PRESERVATION GUARANTEE: adding one entry keeps every other tag, including a-pointers and unknown tags', () => {
    const existing: ListRead = {
      ok: true,
      exists: true,
      tags: [
        ['emoji', 'party', 'https://x.test/p.png'],
        ...SOME_SET_POINTER,
        ...UNKNOWN_FUTURE_TAG,
      ],
    };

    const result = listAfterAddUnicode(existing, '🔥', 'fire');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    expect(result.tags).toEqual([
      ['emoji', 'party', 'https://x.test/p.png'],
      [EMOJI_NATIVE_TAG, 'fire', '🔥'],
      ...SOME_SET_POINTER,
      ...UNKNOWN_FUTURE_TAG,
    ]);
  });
});

describe('listAfterRemove', () => {
  it('removes only the named entry, preserving everything else', () => {
    const read: ListRead = {
      ok: true,
      exists: true,
      tags: [
        ['emoji', 'party', 'https://x.test/p.png'],
        [EMOJI_NATIVE_TAG, 'fire', '🔥'],
        ...SOME_SET_POINTER,
      ],
    };

    const result = listAfterRemove(read, 'party');
    expect(result).toEqual({
      ok: true,
      tags: [[EMOJI_NATIVE_TAG, 'fire', '🔥'], ...SOME_SET_POINTER],
    });
  });

  it('refuses when the shortcode is not present', () => {
    const read: ListRead = { ok: true, exists: true, tags: [] };
    expect(listAfterRemove(read, 'ghost')).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('listAfterMove', () => {
  const read: ListRead = {
    ok: true,
    exists: true,
    tags: [
      [EMOJI_NATIVE_TAG, 'a', 'A'],
      [EMOJI_NATIVE_TAG, 'b', 'B'],
      [EMOJI_NATIVE_TAG, 'c', 'C'],
      ...SOME_SET_POINTER,
    ],
  };

  it('moves an entry up, preserving the a-pointer', () => {
    const result = listAfterMove(read, 'b', 'up');
    expect(result).toEqual({
      ok: true,
      tags: [
        [EMOJI_NATIVE_TAG, 'b', 'B'],
        [EMOJI_NATIVE_TAG, 'a', 'A'],
        [EMOJI_NATIVE_TAG, 'c', 'C'],
        ...SOME_SET_POINTER,
      ],
    });
  });

  it('moves an entry down', () => {
    const result = listAfterMove(read, 'a', 'down');
    expect(result).toEqual({
      ok: true,
      tags: [
        [EMOJI_NATIVE_TAG, 'b', 'B'],
        [EMOJI_NATIVE_TAG, 'a', 'A'],
        [EMOJI_NATIVE_TAG, 'c', 'C'],
        ...SOME_SET_POINTER,
      ],
    });
  });

  it('refuses to move the first entry up, or the last entry down (no-change, not a silent no-op reorder)', () => {
    expect(listAfterMove(read, 'a', 'up')).toEqual({ ok: false, reason: 'no-change' });
    expect(listAfterMove(read, 'c', 'down')).toEqual({ ok: false, reason: 'no-change' });
  });
});

describe('a failed read publishes nothing', () => {
  const brokenRelay: RelayClient = {
    publish: vi.fn(async () => 1),
    fetch: async () => {
      throw new Error('relay unreachable');
    },
  };

  it('addUnicodeEmoji throws instead of publishing a one-entry list over a failed read', async () => {
    const signer = createMockSigner();
    await expect(addUnicodeEmoji(signer, brokenRelay, '🔥', 'fire')).rejects.toThrow(
      /Could not read your current emoji list/,
    );
    expect(brokenRelay.publish).not.toHaveBeenCalled();
  });

  it('addCustomEmoji, removeEmojiEntry and moveEmojiEntry all refuse the same way', async () => {
    const signer = createMockSigner();
    await expect(addCustomEmoji(signer, brokenRelay, 'party', 'https://x.test/p.png')).rejects.toThrow();
    await expect(removeEmojiEntry(signer, brokenRelay, 'party')).rejects.toThrow();
    await expect(moveEmojiEntry(signer, brokenRelay, 'party', 'up')).rejects.toThrow();
    expect(brokenRelay.publish).not.toHaveBeenCalled();
  });
});

describe('zero relays accepting the publish', () => {
  it('throws rather than reporting the edit as saved', async () => {
    const signer = createMockSigner();
    const relay: RelayClient = {
      fetch: async () => [],
      read: async () => ({ events: [], answeredBy: 1 }),
      publish: async () => 0,
    };

    await expect(addUnicodeEmoji(signer, relay, '🔥', 'fire')).rejects.toThrow(/No relay accepted/);
  });
});

describe('end-to-end: add, then add again, preserves the first and any a-pointer', () => {
  it('round-trips through a stateful mock relay', async () => {
    const signer = createMockSigner();
    const store = new Map<string, Event>();
    // Seed an existing list with a set pointer, as if the operator already
    // subscribes to a shared kind:30030 set.
    store.set(PK, fakeEvent(SOME_SET_POINTER, 1));

    const relay: RelayClient = {
      fetch: async () => [...store.values()],
      read: async () => ({ events: [...store.values()], answeredBy: 1 }),
      publish: async (event: Event) => {
        store.set(event.pubkey, event);
        return 1;
      },
    };

    const first = await addUnicodeEmoji(signer, relay, '🔥', 'fire');
    expect(first.ok).toBe(true);

    const second = await addCustomEmoji(signer, relay, 'party', 'https://x.test/p.png');
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('unreachable');

    // The set pointer from BEFORE either edit is still there, and the first
    // edit's entry survived the second edit's read-compute-publish cycle.
    expect(second.tags).toEqual([
      [EMOJI_NATIVE_TAG, 'fire', '🔥'],
      ['emoji', 'party', 'https://x.test/p.png'],
      ...SOME_SET_POINTER,
    ]);
  });
});
