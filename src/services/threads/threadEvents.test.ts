/**
 * @fileoverview Tests for NIP-22 thread assembly.
 *
 * The tag-shape tests pin interoperability: other clients read these events, so
 * getting uppercase/lowercase scope wrong makes threads unreadable elsewhere
 * while still looking correct here.
 *
 * The assembly tests are mostly about hostile input. Parent links come from
 * other clients and relays return partial data as a matter of course, so the
 * interesting cases are missing parents and cycles rather than the happy tree.
 */

import { describe, it, expect } from 'vitest';
import {
  THREAD_KIND,
  buildThreadRootTags,
  buildReplyTags,
  parseThreadEvent,
  assembleThreads,
  type ThreadComment,
} from './threadEvents';

const GROUP = 'relay.cloistr.xyz\'devs';

function comment(over: Partial<ThreadComment> & { id: string }): ThreadComment {
  return {
    pubkey: 'author',
    groupId: GROUP,
    content: '',
    createdAt: 1000,
    ...over,
  };
}

describe('buildThreadRootTags', () => {
  it('scopes to the group and carries a subject', () => {
    expect(buildThreadRootTags(GROUP, 'Release plan')).toEqual([
      ['h', GROUP],
      ['subject', 'Release plan'],
    ]);
  });

  it('omits an empty subject rather than writing a blank tag', () => {
    expect(buildThreadRootTags(GROUP, '   ')).toEqual([['h', GROUP]]);
  });

  it('has no E or e tag, which is what makes it a root', () => {
    const tags = buildThreadRootTags(GROUP, 'x');
    expect(tags.some((t) => t[0] === 'E' || t[0] === 'e')).toBe(false);
  });
});

describe('buildReplyTags', () => {
  it('writes uppercase root scope and lowercase parent', () => {
    const tags = buildReplyTags(GROUP, {
      rootId: 'root1',
      rootPubkey: 'rootAuthor',
      parentId: 'reply1',
      parentPubkey: 'replyAuthor',
    });

    // Uppercase = the whole thread, so any reply can locate its root.
    expect(tags).toContainEqual(['E', 'root1', '', 'rootAuthor']);
    expect(tags).toContainEqual(['K', String(THREAD_KIND)]);
    expect(tags).toContainEqual(['P', 'rootAuthor']);
    // Lowercase = immediate parent, so nesting is recoverable.
    expect(tags).toContainEqual(['e', 'reply1', '', 'replyAuthor']);
    expect(tags).toContainEqual(['p', 'replyAuthor']);
    expect(tags).toContainEqual(['h', GROUP]);
  });

  it('writes both scopes even when the parent IS the root', () => {
    // Tempting to emit only E here. Doing so loses the parent link for any
    // reply nested under this one.
    const tags = buildReplyTags(GROUP, {
      rootId: 'root1',
      rootPubkey: 'a',
      parentId: 'root1',
      parentPubkey: 'a',
    });

    expect(tags).toContainEqual(['E', 'root1', '', 'a']);
    expect(tags).toContainEqual(['e', 'root1', '', 'a']);
  });

  it('records a non-1111 parent kind so a thread can hang off chat history', () => {
    // Replying to a kind:9 message is how threads attach to existing chat
    // without rewriting it.
    const tags = buildReplyTags(GROUP, {
      rootId: 'root1',
      rootPubkey: 'a',
      parentId: 'chatmsg',
      parentPubkey: 'b',
      parentKind: 9,
    });

    expect(tags).toContainEqual(['k', '9']);
    // Root scope stays 1111 -- the thread is still a thread.
    expect(tags).toContainEqual(['K', String(THREAD_KIND)]);
  });
});

describe('parseThreadEvent', () => {
  it('extracts root, parent and subject', () => {
    const parsed = parseThreadEvent(
      {
        id: 'r1',
        pubkey: 'author',
        content: 'hello',
        created_at: 500,
        tags: [
          ['h', GROUP],
          ['E', 'root1', '', 'a'],
          ['e', 'parent1', '', 'b'],
        ],
      },
      GROUP
    );

    expect(parsed).toMatchObject({
      id: 'r1',
      rootId: 'root1',
      parentId: 'parent1',
      content: 'hello',
      createdAt: 500,
    });
  });

  it('rejects an event scoped to a different group', () => {
    // Not a display nicety: rendering another group's thread here would leak
    // content across a membership boundary.
    expect(
      parseThreadEvent(
        { id: 'x', pubkey: 'a', content: '', tags: [['h', 'other\'group']] },
        GROUP
      )
    ).toBeNull();
  });

  it('rejects an event with no h tag at all', () => {
    expect(parseThreadEvent({ id: 'x', pubkey: 'a', content: '', tags: [] }, GROUP)).toBeNull();
  });
});

describe('assembleThreads', () => {
  it('nests replies under their parents', () => {
    const threads = assembleThreads([
      comment({ id: 'root', subject: 'T', createdAt: 1 }),
      comment({ id: 'a', rootId: 'root', parentId: 'root', createdAt: 2 }),
      comment({ id: 'b', rootId: 'root', parentId: 'a', createdAt: 3 }),
    ]);

    expect(threads).toHaveLength(1);
    expect(threads[0].replies[0].id).toBe('a');
    expect(threads[0].replies[0].replies[0].id).toBe('b');
    expect(threads[0].replies[0].depth).toBe(0);
    expect(threads[0].replies[0].replies[0].depth).toBe(1);
    expect(threads[0].replyCount).toBe(2);
  });

  it('re-attaches an orphaned reply to the root instead of dropping it', () => {
    // A relay returning a reply without its parent is routine -- paging,
    // retention, deletion. Dropping it makes a message silently vanish.
    const threads = assembleThreads([
      comment({ id: 'root', createdAt: 1 }),
      comment({ id: 'orphan', rootId: 'root', parentId: 'never-fetched', createdAt: 2 }),
    ]);

    expect(threads[0].replies.map((r) => r.id)).toEqual(['orphan']);
    expect(threads[0].replyCount).toBe(1);
  });

  it('terminates on a reply cycle instead of hanging', () => {
    // Two replies naming each other as parent. An uncapped recursive walk
    // would never return and would take the render thread with it.
    const threads = assembleThreads([
      comment({ id: 'root', createdAt: 1 }),
      comment({ id: 'x', rootId: 'root', parentId: 'y', createdAt: 2 }),
      comment({ id: 'y', rootId: 'root', parentId: 'x', createdAt: 3 }),
    ]);

    expect(threads).toHaveLength(1);
    // Both are still reachable rather than discarded.
    const ids: string[] = [];
    const walk = (nodes: typeof threads[0]['replies']) => {
      for (const n of nodes) {
        ids.push(n.id);
        walk(n.replies);
      }
    };
    walk(threads[0].replies);
    expect(ids.sort()).toEqual(['x', 'y']);
  });

  it('ignores replies whose root is not present', () => {
    // Otherwise a stray reply would conjure a thread with no opening post.
    const threads = assembleThreads([
      comment({ id: 'root', createdAt: 1 }),
      comment({ id: 'stray', rootId: 'some-other-thread', parentId: 'x', createdAt: 9 }),
    ]);

    expect(threads).toHaveLength(1);
    expect(threads[0].replyCount).toBe(0);
  });

  it('sorts by last activity, not by thread age', () => {
    // An old thread someone just replied to is more likely to be wanted than a
    // newer one nobody has touched.
    const threads = assembleThreads([
      comment({ id: 'old', createdAt: 1 }),
      comment({ id: 'new', createdAt: 100 }),
      comment({ id: 'r', rootId: 'old', parentId: 'old', createdAt: 200 }),
    ]);

    expect(threads.map((t) => t.root.id)).toEqual(['old', 'new']);
    expect(threads[0].lastActivity).toBe(200);
  });

  it('orders sibling replies oldest first', () => {
    const threads = assembleThreads([
      comment({ id: 'root', createdAt: 1 }),
      comment({ id: 'second', rootId: 'root', parentId: 'root', createdAt: 30 }),
      comment({ id: 'first', rootId: 'root', parentId: 'root', createdAt: 20 }),
    ]);

    expect(threads[0].replies.map((r) => r.id)).toEqual(['first', 'second']);
  });

  it('returns nothing for an empty input', () => {
    expect(assembleThreads([])).toEqual([]);
  });
});
