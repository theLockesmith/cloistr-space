/**
 * @fileoverview The public half of the one thread list (threads.md 3.1, 3.3, 6).
 *
 * Takes raw kind 11 / 1111 events and kind 1985 labels, decides which events
 * this user may see, assembles each scope's threads, and applies the owner's
 * status. Pure: the hook supplies events, this decides what they mean.
 *
 * Scope is the `h` tag. A group's threads reach the list only for a member of
 * that group, or when the user wrote the event themselves; anything else a
 * relay returns is dropped here, before it can be counted or searched.
 */

import {
  parsePublicThreadEvent,
  foldThreadStatus,
  applyThreadStatus,
  assembleThreads,
  type PublicEvent,
  type PublicThreadComment,
  type VisibleThread,
} from '@cloistr/threads';

export interface PublicThreadItem {
  thread: VisibleThread;
  /** The project the thread lives in; null for a thread outside any. */
  groupId: string | null;
  /** 11, or 1111 for a legacy root. A reply's `K` must name it. */
  rootKind: number;
}

export interface AdmitContext {
  memberGroups: ReadonlySet<string>;
  me: string | null;
}

/** The event as a thread comment, if this user may see it; null drops it. */
export function admitPublicEvent(event: PublicEvent, ctx: AdmitContext): PublicThreadComment | null {
  // A `thread` tag marks the kit's legacy sealed format: ciphertext for a key
  // holder, read by the private path, never shown here as a public post.
  if (event.tags.some((t) => t[0] === 'thread')) return null;

  const h = event.tags.find((t) => t[0] === 'h')?.[1];
  if (h && !ctx.memberGroups.has(h) && event.pubkey !== ctx.me) return null;
  return parsePublicThreadEvent(event, h);
}

/**
 * Threads per scope, status applied, newest activity first.
 *
 * Assembled per scope because a reply can only belong to a root in its own
 * group; pooling them would let an id collision cross a membership boundary.
 * Status is honoured only from the root's author: a public thread has no
 * co-owners, and on a public relay anyone can publish a label.
 */
export function foldPublicThreads(comments: PublicThreadComment[], labels: PublicEvent[]): PublicThreadItem[] {
  const byScope = new Map<string, PublicThreadComment[]>();
  const kindOf = new Map<string, number>();
  for (const c of comments) {
    kindOf.set(c.id, c.kind);
    const bucket = byScope.get(c.groupId);
    if (bucket) bucket.push(c);
    else byScope.set(c.groupId, [c]);
  }

  const labelsByRoot = new Map<string, PublicEvent[]>();
  for (const l of labels) {
    for (const t of l.tags) {
      if (t[0] !== 'e' || !t[1]) continue;
      const bucket = labelsByRoot.get(t[1]);
      if (bucket) bucket.push(l);
      else labelsByRoot.set(t[1], [l]);
    }
  }

  const out: PublicThreadItem[] = [];
  for (const [scope, scoped] of byScope) {
    for (const thread of assembleThreads(scoped)) {
      const folded = foldThreadStatus(labelsByRoot.get(thread.root.id) ?? [], thread.root.id, [thread.root.pubkey]);
      out.push({
        thread: applyThreadStatus(thread, folded),
        groupId: scope || null,
        rootKind: kindOf.get(thread.root.id) ?? 0,
      });
    }
  }
  return out.sort((a, b) => b.thread.lastActivity - a.thread.lastActivity);
}

/**
 * Client-side search (threads.md 6; relay search waits on Q11): the title, the
 * opening post and every reply still shown. Replies an archive hides are not
 * searched, since a match there would open onto nothing visible.
 */
export function matchesSearch(item: PublicThreadItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const { root, replies } = item.thread;
  if ((root.subject ?? '').toLowerCase().includes(q) || root.content.toLowerCase().includes(q)) return true;
  const stack = [...replies];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.content.toLowerCase().includes(q)) return true;
    stack.push(...node.replies);
  }
  return false;
}
