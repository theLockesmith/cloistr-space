/**
 * @fileoverview Tests for the feed render snapshot.
 *
 * The interesting cases are all failures, because this runs in a browser we do
 * not control: storage that throws on touch, a payload written by a previous
 * version of the app, a quota that rejects the write. None of those may break
 * the feed -- the worst allowed outcome is the behaviour we already had.
 */

import { describe, it, expect } from 'vitest';
import {
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
  snapshotKey,
  shouldPersist,
  upsertNote,
  SNAPSHOT_LIMIT,
} from './feedSnapshot';
import type { Note } from '@/types/social';

const NO_ENGAGEMENT = {
  reactions: 0,
  reposts: 0,
  replies: 0,
  zaps: 0,
  zapAmount: 0,
  zapCount: 0,
};

// No `as Note`. The cast that was here hid two missing required fields, which
// is the whole point of having the type.
function note(id: string, createdAt = 1000, content = 'hello'): Note {
  return {
    id,
    pubkey: 'b'.repeat(64),
    content,
    createdAt,
    mentions: [],
    hashtags: [],
    media: [],
    engagement: { ...NO_ENGAGEMENT },
    userReacted: false,
    userReposted: false,
    userZapped: false,
  };
}

/** A Storage that actually stores, so a roundtrip is a real roundtrip. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

/** Private browsing, disabled site data, quota -- all surface as a throw. */
function hostileStorage(): Storage {
  const thrower = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  return {
    length: 0,
    clear: thrower,
    getItem: thrower,
    key: thrower,
    removeItem: thrower,
    setItem: thrower,
  } as unknown as Storage;
}

describe('feedSnapshot', () => {
  it('restores what it saved', () => {
    const s = fakeStorage();
    saveSnapshot([note('a'), note('b')], 'following', 'pk', s);

    expect(loadSnapshot('following', 'pk', s).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('keeps modes and accounts apart', () => {
    // Without this, signing in as someone else shows the previous account's
    // feed, and the global feed's contents appear under "following" -- which
    // reads as a follow list that is not yours.
    const s = fakeStorage();
    saveSnapshot([note('mine')], 'following', 'pk-1', s);

    expect(loadSnapshot('following', 'pk-2', s)).toEqual([]);
    expect(loadSnapshot('global', 'pk-1', s)).toEqual([]);
    expect(snapshotKey('following', 'pk-1')).not.toBe(snapshotKey('following', 'pk-2'));
  });

  it('ignores a payload from a previous Note shape', () => {
    const s = fakeStorage();
    s.setItem(snapshotKey('following', 'pk'), JSON.stringify({ v: 999, notes: [note('old')] }));

    expect(loadSnapshot('following', 'pk', s)).toEqual([]);
  });

  it('ignores corrupt JSON rather than throwing into render', () => {
    const s = fakeStorage();
    s.setItem(snapshotKey('following', 'pk'), '{ this is not json');

    expect(() => loadSnapshot('following', 'pk', s)).not.toThrow();
    expect(loadSnapshot('following', 'pk', s)).toEqual([]);
  });

  it('drops entries that do not look like notes', () => {
    // A half-written or hand-edited entry must not reach the renderer, which
    // will happily dereference note.engagement.reactions.
    const s = fakeStorage();
    s.setItem(
      snapshotKey('following', 'pk'),
      JSON.stringify({ v: 2, notes: [note('good'), { id: 'bad' }, null, 'nope'] })
    );

    expect(loadSnapshot('following', 'pk', s).map((n) => n.id)).toEqual(['good']);
  });

  it('survives storage that throws on touch', () => {
    const s = hostileStorage();

    expect(() => saveSnapshot([note('a')], 'following', 'pk', s)).not.toThrow();
    expect(saveSnapshot([note('a')], 'following', 'pk', s)).toBe(false);
    expect(loadSnapshot('following', 'pk', s)).toEqual([]);
    expect(() => clearSnapshot('following', 'pk', s)).not.toThrow();
  });

  it('treats an explicit null storage as none, not as "use the default"', () => {
    expect(saveSnapshot([note('a')], 'following', 'pk', null)).toBe(false);
    expect(loadSnapshot('following', 'pk', null)).toEqual([]);
  });

  it('caps how many notes it keeps', () => {
    const s = fakeStorage();
    const many = Array.from({ length: SNAPSHOT_LIMIT + 25 }, (_, i) => note(`n${i}`));
    saveSnapshot(many, 'following', 'pk', s);

    expect(loadSnapshot('following', 'pk', s)).toHaveLength(SNAPSHOT_LIMIT);
  });

  it('sheds notes rather than blowing the quota on huge content', () => {
    // Note content is user-controlled and unbounded. Storing 50 of these
    // unconditionally is how you get a QuotaExceededError in someone else's
    // feature three weeks later.
    const s = fakeStorage();
    const huge = Array.from({ length: 40 }, (_, i) => note(`h${i}`, 1000, 'x'.repeat(20_000)));

    expect(saveSnapshot(huge, 'following', 'pk', s)).toBe(true);

    const restored = loadSnapshot('following', 'pk', s);
    expect(restored.length).toBeGreaterThan(0);
    expect(restored.length).toBeLessThan(40);
  });

  it('refuses rather than throwing when even one note is over the cap', () => {
    const s = fakeStorage();

    expect(saveSnapshot([note('vast', 1000, 'x'.repeat(400_000))], 'following', 'pk', s)).toBe(false);
    expect(loadSnapshot('following', 'pk', s)).toEqual([]);
  });

  it('clears a snapshot', () => {
    const s = fakeStorage();
    saveSnapshot([note('a')], 'following', 'pk', s);
    clearSnapshot('following', 'pk', s);

    expect(loadSnapshot('following', 'pk', s)).toEqual([]);
  });
});

describe('shouldPersist', () => {
  it('refuses to write notes belonging to another filter', () => {
    // THE regression. Switching filters left `notes` in place, the new mode's
    // snapshot was merged into them, and the union was saved under the new
    // mode's key -- growing with every switch until all three filters rendered
    // the same thing. Reported as "only showing my content (except now it's
    // across all 3 view filters)".
    expect(shouldPersist('following:pk', 'wot:pk', 20)).toBe(false);
  });

  it('refuses to write notes belonging to another account', () => {
    // Same hazard across a sign-out: the previous user's feed must not be
    // written into the next user's snapshot.
    expect(shouldPersist('following:pk-1', 'following:pk-2', 20)).toBe(false);
  });

  it('allows a write when the notes belong where they are going', () => {
    expect(shouldPersist('following:pk', 'following:pk', 20)).toBe(true);
  });

  it('refuses an empty feed', () => {
    // refresh() empties notes before refilling them. Writing that through would
    // destroy the snapshot at the moment it is most likely to be wanted.
    expect(shouldPersist('following:pk', 'following:pk', 0)).toBe(false);
  });

  it('refuses before ownership is established', () => {
    expect(shouldPersist(null, 'following:pk', 20)).toBe(false);
  });
});

describe('upsertNote', () => {
  it('does not add the same event twice', () => {
    // THE regression. The restore put notes on screen and cleared the seen-set
    // without seeding it, so the live subscription redelivered every one and
    // the feed rendered adjacent identical pairs with the same React key.
    const first = note('same', 1000);
    const list = upsertNote([], first);

    expect(upsertNote(list, note('same', 1000))).toHaveLength(1);
  });

  it('IGNORES a redelivery rather than replacing the note in place', () => {
    // An event id is a hash over pubkey, created_at, kind, tags and content, so
    // a second copy is byte-identical and carries nothing new. The note already
    // in the list, however, has engagement counts and optimistic react flags
    // folded into it by applyEngagement -- replacing it would reset reaction
    // counts to zero and un-fill a heart the user had just tapped.
    const withEngagement = {
      ...note('same'),
      engagement: { ...NO_ENGAGEMENT, reactions: 7 },
      userReacted: true,
    };
    const list = upsertNote([], withEngagement);
    const next = upsertNote(list, note('same'));

    expect(next).toHaveLength(1);
    expect(next[0].engagement.reactions).toBe(7);
    expect(next[0].userReacted).toBe(true);
  });

  it('returns the SAME array on a redelivery', () => {
    // toBe, not toEqual. A new array of equal contents re-renders the whole
    // feed, and with the outbox model one note arrives from every relay that
    // carries it -- so this is the difference between a quiet feed and a
    // render storm once the subscription stays open past eose.
    const list = upsertNote([], note('same'));

    expect(upsertNote(list, note('same'))).toBe(list);
  });

  it('keeps newest first', () => {
    let list: Note[] = [];
    for (const [id, t] of [['mid', 2000], ['old', 1000], ['new', 3000]] as const) {
      list = upsertNote(list, note(id, t));
    }

    expect(list.map((n) => n.id)).toEqual(['new', 'mid', 'old']);
  });

  it('preserves order when replacing', () => {
    // createdAt is part of the event id's preimage, so a replacement cannot
    // change where the note belongs -- but if that ever stopped being true,
    // silently reordering the feed under the reader would be the symptom.
    let list: Note[] = [];
    list = upsertNote(list, note('a', 3000));
    list = upsertNote(list, note('b', 2000));
    list = upsertNote(list, note('c', 1000));

    const next = upsertNote(list, { ...note('b', 2000), content: 'edited' });

    expect(next.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('dedups the same event arriving from many relays', () => {
    // Enabling the outbox model means one note comes back from every relay
    // that carries it. Deduplication that was never needed is now load-bearing.
    let list: Note[] = [];
    for (let i = 0; i < 11; i++) list = upsertNote(list, note('echoed', 1000));

    expect(list).toHaveLength(1);
  });

  it('does not mutate the array it was given', () => {
    const list = [note('a')];
    upsertNote(list, note('b'));

    expect(list).toHaveLength(1);
  });
  it('sorts a repost by boostedAt, not by the original createdAt', () => {
    // A note posted 3 days ago, boosted 1 minute ago, must appear at the top of
    // the feed -- the boost is the recent event that brought it here. Without
    // this fix a repost always sinks to where the original note sits in time.
    let list: Note[] = [];
    list = upsertNote(list, note('recent-original', 9000));
    list = upsertNote(list, {
      ...note('old-original', 1000),
      repostBy: { pubkey: 'c'.repeat(64), boostedAt: 9999 },
    });

    // The boosted note has boostedAt=9999 > recent-original createdAt=9000.
    expect(list.map((n) => n.id)).toEqual(['old-original', 'recent-original']);
  });

  it('falls back to createdAt for a note without repostBy', () => {
    let list: Note[] = [];
    list = upsertNote(list, note('new', 5000));
    list = upsertNote(list, note('old', 1000));

    expect(list.map((n) => n.id)).toEqual(['new', 'old']);
  });

});
