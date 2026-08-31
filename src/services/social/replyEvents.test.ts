/**
 * @fileoverview Tests for NIP-10 reply threading.
 *
 * The convention choice is the thing worth pinning: we READ NIP-10 kind:1 and
 * NIP-22 kind:1111, and we WRITE NIP-10. The line is the TARGET's kind, not a
 * preference -- a reply to a kind:1 note written as kind:1111 would be
 * invisible to every client that reads NIP-10, which is all the ones people
 * use.
 *
 * The deprecated positional form matters more than it looks: a large share of
 * stored replies predate markers, and treating those as top-level notes would
 * silently flatten old threads rather than fail loudly.
 */

import { describe, it, expect } from 'vitest';
import {
  buildReplyTags,
  parseReplyTags,
  parseCommentTags,
  assembleReplies,
} from './replyEvents';

const ROOT = 'a'.repeat(64);
const PARENT = 'b'.repeat(64);
const AUTHOR = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);
const RELAY = 'wss://relay.cloistr.xyz';

describe('buildReplyTags', () => {
  it('marks a direct reply to a root with root only', () => {
    // A "reply" marker pointing at the same id as "root" is noise that some
    // clients render as a self-reference.
    const tags = buildReplyTags({ id: ROOT, pubkey: AUTHOR });

    expect(tags.filter((t) => t[0] === 'e')).toEqual([['e', ROOT, '', 'root']]);
  });

  it('emits both markers when replying to a reply', () => {
    const tags = buildReplyTags({ id: PARENT, pubkey: AUTHOR, rootId: ROOT });
    const e = tags.filter((t) => t[0] === 'e');

    expect(e).toEqual([
      ['e', ROOT, '', 'root'],
      ['e', PARENT, '', 'reply'],
    ]);
  });

  it('carries a relay hint into both markers', () => {
    const tags = buildReplyTags({ id: PARENT, pubkey: AUTHOR, rootId: ROOT, relay: RELAY });

    expect(tags.filter((t) => t[0] === 'e').every((t) => t[2] === RELAY)).toBe(true);
  });

  it('p-tags the author being answered', () => {
    const tags = buildReplyTags({ id: ROOT, pubkey: AUTHOR });

    expect(tags).toContainEqual(['p', AUTHOR]);
  });

  it('dedups p tags', () => {
    // A repeated p tag is a repeated notification.
    const tags = buildReplyTags({ id: ROOT, pubkey: AUTHOR }, [AUTHOR, OTHER, OTHER]);

    expect(tags.filter((t) => t[0] === 'p')).toEqual([
      ['p', AUTHOR],
      ['p', OTHER],
    ]);
  });
});

describe('parseReplyTags', () => {
  it('reads marked tags', () => {
    expect(
      parseReplyTags([
        ['e', ROOT, '', 'root'],
        ['e', PARENT, '', 'reply'],
      ])
    ).toEqual({ root: ROOT, replyTo: PARENT });
  });

  it('treats a lone root marker as answering the root', () => {
    expect(parseReplyTags([['e', ROOT, '', 'root']])).toEqual({ root: ROOT, replyTo: ROOT });
  });

  it('falls back to the deprecated positional form', () => {
    // First e tag is the root, last is what is being replied to. Without this,
    // pre-marker replies would look like top-level notes and old threads would
    // silently flatten.
    expect(parseReplyTags([['e', ROOT], ['e', 'x'.repeat(64)], ['e', PARENT]])).toEqual({
      root: ROOT,
      replyTo: PARENT,
    });
  });

  it('treats a single positional e tag as both', () => {
    expect(parseReplyTags([['e', ROOT]])).toEqual({ root: ROOT, replyTo: ROOT });
  });

  it('prefers markers when both forms are present', () => {
    expect(
      parseReplyTags([
        ['e', 'z'.repeat(64)],
        ['e', ROOT, '', 'root'],
        ['e', PARENT, '', 'reply'],
      ])
    ).toEqual({ root: ROOT, replyTo: PARENT });
  });

  it('returns empty for a top-level note', () => {
    expect(parseReplyTags([['p', AUTHOR], ['t', 'nostr']])).toEqual({});
  });
});

describe('parseCommentTags', () => {
  it('reads NIP-22 lowercase e as the immediate parent', () => {
    expect(parseCommentTags([['E', ROOT], ['e', PARENT]])).toEqual({
      root: ROOT,
      replyTo: PARENT,
    });
  });

  it('falls back to the root when only E is present', () => {
    expect(parseCommentTags([['E', ROOT]])).toEqual({ root: ROOT, replyTo: ROOT });
  });
});

describe('assembleReplies', () => {
  const reply = (id: string, replyTo: string, createdAt = 1000) => ({ id, replyTo, createdAt });

  it('nests replies under their parent', () => {
    const tree = assembleReplies(ROOT, [reply('a', ROOT), reply('b', 'a')]);

    expect(tree).toHaveLength(1);
    expect(tree[0].event.id).toBe('a');
    expect(tree[0].children[0].event.id).toBe('b');
  });

  it('orders siblings oldest first', () => {
    // A conversation reads forward. Newest-first is right for a feed and wrong
    // for a thread.
    const tree = assembleReplies(ROOT, [reply('late', ROOT, 3000), reply('early', ROOT, 1000)]);

    expect(tree.map((n) => n.event.id)).toEqual(['early', 'late']);
  });

  it('reparents an orphan to the root instead of losing it', () => {
    // A reply whose parent we never received would otherwise vanish. Showing it
    // slightly out of place beats not showing that a response exists.
    const tree = assembleReplies(ROOT, [reply('orphan', 'never-received')]);

    expect(tree).toHaveLength(1);
    expect(tree[0].event.id).toBe('orphan');
  });

  it('survives a reference cycle', () => {
    // Malicious or corrupt events can reference each other. A naive recursive
    // walk never returns.
    const tree = assembleReplies(ROOT, [
      { id: 'a', replyTo: 'b', createdAt: 1 },
      { id: 'b', replyTo: 'a', createdAt: 2 },
    ]);

    expect(Array.isArray(tree)).toBe(true);
  });

  it('bounds depth', () => {
    const chain = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      replyTo: i === 0 ? ROOT : `n${i - 1}`,
      createdAt: i,
    }));

    let node = assembleReplies(ROOT, chain, 3)[0];
    let depth = 0;
    while (node?.children.length) {
      node = node.children[0];
      depth++;
    }

    expect(depth).toBeLessThanOrEqual(3);
  });

  it('returns nothing for a thread with no replies', () => {
    expect(assembleReplies(ROOT, [])).toEqual([]);
  });
});
