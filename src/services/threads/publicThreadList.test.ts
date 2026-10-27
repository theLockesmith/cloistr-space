/**
 * @fileoverview The public half of the one thread list (threads.md 3.1, 3.3, 6).
 *
 * The admit tests are about scope: a group's threads must not reach someone
 * outside the group through the unified list. The status tests are about who
 * may archive, since on a public relay anyone can publish a label.
 */

import { describe, it, expect } from 'vitest';
import {
  THREAD_ROOT_KIND,
  STATUS_LABEL_KIND,
  STATUS_NAMESPACE,
  buildPublicRootTags,
  buildPublicReplyTags,
  type PublicEvent,
} from '@cloistr/threads';
import { THREAD_KIND } from './threadEvents';
import { admitPublicEvent, foldPublicThreads, matchesSearch, type PublicThreadItem } from './publicThreadList';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const GROUP = 'devs';
const ctx = { memberGroups: new Set([GROUP]), me: ME };

function ev(over: Partial<PublicEvent> & { id: string }): PublicEvent {
  return { pubkey: ME, kind: THREAD_ROOT_KIND, content: '', created_at: 1000, tags: [], ...over };
}

const root = (id: string, title: string, over: Partial<PublicEvent> = {}) =>
  ev({ id, tags: buildPublicRootTags({ title }), ...over });

const reply = (id: string, rootId: string, at: number, over: Partial<PublicEvent> = {}) =>
  ev({
    id,
    kind: THREAD_KIND,
    pubkey: OTHER,
    created_at: at,
    content: id,
    tags: buildPublicReplyTags({ rootId, rootPubkey: ME, parentId: rootId, parentPubkey: ME }),
    ...over,
  });

const label = (rootId: string, status: string, at: number, pubkey = ME): PublicEvent => ({
  id: `l-${rootId}-${at}-${pubkey.slice(0, 4)}`,
  pubkey,
  kind: STATUS_LABEL_KIND,
  content: '',
  created_at: at,
  tags: [['L', STATUS_NAMESPACE], ['l', status, STATUS_NAMESPACE], ['e', rootId]],
});

function fold(events: PublicEvent[], labels: PublicEvent[] = []): PublicThreadItem[] {
  const comments = events.map((e) => admitPublicEvent(e, ctx)).filter((c) => c !== null);
  return foldPublicThreads(comments, labels);
}

describe('admitPublicEvent', () => {
  it("admits a thread in the user's group, scoped to it", () => {
    const c = admitPublicEvent(ev({ id: 'r', pubkey: OTHER, tags: buildPublicRootTags({ title: 't', groupId: GROUP }) }), ctx);
    expect(c).toMatchObject({ id: 'r', groupId: GROUP });
  });

  it("drops someone else's thread in a group the user is not in", () => {
    const e = ev({ id: 'r', pubkey: OTHER, tags: buildPublicRootTags({ title: 't', groupId: 'elsewhere' }) });
    expect(admitPublicEvent(e, ctx)).toBeNull();
  });

  it("keeps the user's own thread in a group they are not in", () => {
    const e = ev({ id: 'r', tags: buildPublicRootTags({ title: 't', groupId: 'elsewhere' }) });
    expect(admitPublicEvent(e, ctx)).toMatchObject({ groupId: 'elsewhere' });
  });

  it('admits an ungrouped root with no project', () => {
    expect(admitPublicEvent(root('r', 't'), ctx)).toMatchObject({ groupId: '' });
  });

  it('reads a legacy kind 1111 root by its subject', () => {
    const e = ev({ id: 'r', kind: THREAD_KIND, tags: [['h', GROUP], ['subject', 'Old']] });
    expect(admitPublicEvent(e, ctx)).toMatchObject({ subject: 'Old', kind: THREAD_KIND });
  });

  it('leaves a sealed kind 1111 to the private path', () => {
    // The kit's legacy sealed messages carry a `thread` tag and ciphertext.
    const e = ev({ id: 'r', kind: THREAD_KIND, tags: [['h', GROUP], ['thread', OTHER], ['d', 'x']] });
    expect(admitPublicEvent(e, ctx)).toBeNull();
  });
});

describe('foldPublicThreads', () => {
  it('puts replies under their root and keeps the root kind for replying', () => {
    const [item] = fold([root('r', 'Plan'), reply('x', 'r', 1100)]);
    expect(item.thread.root.subject).toBe('Plan');
    expect(item.thread.replies.map((n) => n.id)).toEqual(['x']);
    expect(item.rootKind).toBe(THREAD_ROOT_KIND);
    expect(item.groupId).toBeNull();
  });

  it('keeps a grouped thread in its group and an ungrouped one in none', () => {
    const grouped = ev({ id: 'g', pubkey: OTHER, tags: buildPublicRootTags({ title: 'g', groupId: GROUP }) });
    const items = fold([grouped, root('u', 'u')]);
    expect(items.map((i) => [i.thread.root.id, i.groupId]).sort()).toEqual([
      ['g', GROUP],
      ['u', null],
    ]);
  });

  it('newest activity first', () => {
    const items = fold([root('old', 'a', { created_at: 10 }), root('new', 'b', { created_at: 20 }), reply('late', 'old', 30)]);
    expect(items.map((i) => i.thread.root.id)).toEqual(['old', 'new']);
  });

  it("archives on the owner's label and hides replies dated after it", () => {
    const [item] = fold([root('r', 't'), reply('before', 'r', 1100), reply('after', 'r', 1300)], [label('r', 'archived', 1200)]);
    expect(item.thread.status).toBe('archived');
    expect(item.thread.replies.map((n) => n.id)).toEqual(['before']);
    expect(item.thread.hiddenLaterReplies).toBe(1);
    // A late reply must not bump an archived thread up the list.
    expect(item.thread.lastActivity).toBe(1100);
  });

  it("ignores an archive label from anyone but the thread's author", () => {
    const [item] = fold([root('r', 't')], [label('r', 'archived', 1200, OTHER)]);
    expect(item.thread.status).toBe('open');
  });

  it('a label for one thread does not archive another', () => {
    const items = fold([root('r1', 'a'), root('r2', 'b')], [label('r1', 'archived', 1200)]);
    const byId = new Map(items.map((i) => [i.thread.root.id, i.thread.status]));
    expect(byId.get('r1')).toBe('archived');
    expect(byId.get('r2')).toBe('open');
  });
});

describe('matchesSearch', () => {
  const [item] = fold([root('r', 'Release plan', { content: 'Ship on Friday' }), reply('x', 'r', 1100, { content: 'Needs QA first' })]);

  it('matches everything on an empty query', () => {
    expect(matchesSearch(item, '  ')).toBe(true);
  });

  it('matches the title, the opening post and replies, ignoring case', () => {
    expect(matchesSearch(item, 'RELEASE')).toBe(true);
    expect(matchesSearch(item, 'friday')).toBe(true);
    expect(matchesSearch(item, 'qa first')).toBe(true);
  });

  it('does not match what is not there', () => {
    expect(matchesSearch(item, 'budget')).toBe(false);
  });
});
