/**
 * @fileoverview NIP-22 (kind:1111) threading for NIP-29 groups.
 *
 * Threads are a PARALLEL construct to the existing kind:9 group chat, not a
 * reinterpretation of it. Retrofitting kind:9 messages into thread roots would
 * rewrite the meaning of live group history that other clients already read
 * and render; a kind:1111 can reference a kind:9 without that message changing,
 * so nothing has to be migrated and nothing another client relies on moves.
 *
 * Pure: no React, no NDK. The tag shapes and the tree assembly are the parts
 * worth testing on their own.
 */

/** NIP-22 comment. */
export const THREAD_KIND = 1111;

/**
 * A thread root.
 *
 * NIP-22 marks scope with uppercase tags (E/K/P for the root, plus A/I for
 * addressable and external roots) and the immediate parent with lowercase
 * (e/k/p). A root therefore has no E and no e -- it is the thing being replied
 * to rather than a reply.
 *
 * Group scoping uses the NIP-29 `h` tag, the same as every other event in a
 * group, so relays already filter on it and a thread cannot escape its group.
 * Deliberately not an A tag pointing at the group's kind:39000 metadata: that
 * would require knowing the group's owner pubkey to build the address, which
 * this client does not always have, and getting it wrong would scope threads to
 * an address nothing else in the group uses.
 */
export function buildThreadRootTags(groupId: string, subject: string): string[][] {
  const tags: string[][] = [['h', groupId]];

  const trimmed = subject.trim();
  if (trimmed) {
    tags.push(['subject', trimmed]);
  }

  return tags;
}

export interface ReplyTarget {
  /** The thread root being replied within. */
  rootId: string;
  rootPubkey: string;
  /** The message being replied to. Equals the root for a top-level reply. */
  parentId: string;
  parentPubkey: string;
  /**
   * Kind of the parent. Almost always 1111, but a reply whose parent is a
   * kind:9 chat message is legal and is how a thread can hang off existing
   * chat history without rewriting it.
   */
  parentKind?: number;
}

/**
 * Build reply tags.
 *
 * Uppercase carries the ROOT scope so a client can find the whole thread from
 * any reply in it. Lowercase carries the immediate parent so nesting is
 * recoverable. Emitting only one of the two would make either the thread or
 * the tree structure unrecoverable, which is why both are always written even
 * when parent and root are the same event.
 */
export function buildReplyTags(groupId: string, target: ReplyTarget): string[][] {
  const parentKind = target.parentKind ?? THREAD_KIND;

  return [
    ['h', groupId],
    // Root scope.
    ['E', target.rootId, '', target.rootPubkey],
    ['K', String(THREAD_KIND)],
    ['P', target.rootPubkey],
    // Immediate parent.
    ['e', target.parentId, '', target.parentPubkey],
    ['k', String(parentKind)],
    ['p', target.parentPubkey],
  ];
}

/** A kind:1111 event reduced to what the UI needs. */
export interface ThreadComment {
  id: string;
  pubkey: string;
  groupId: string;
  content: string;
  createdAt: number;
  /** Thread root id. Undefined on a root itself. */
  rootId?: string;
  /** Immediate parent id. Undefined on a root itself. */
  parentId?: string;
  /** Root-only: the thread title. */
  subject?: string;
}

interface RawEvent {
  id: string;
  pubkey: string;
  content: string;
  created_at?: number;
  tags: string[][];
}

/**
 * Parse a kind:1111 event.
 *
 * Returns null when the event is not for this group. The h tag is checked
 * rather than trusted because a subscription can deliver events a relay
 * matched loosely, and rendering another group's thread inside this one would
 * be a confidentiality problem, not just a display bug.
 */
export function parseThreadEvent(event: RawEvent, groupId: string): ThreadComment | null {
  const hTag = event.tags.find((t) => t[0] === 'h');
  if (!hTag || hTag[1] !== groupId) return null;

  const rootTag = event.tags.find((t) => t[0] === 'E');
  const parentTag = event.tags.find((t) => t[0] === 'e');
  const subjectTag = event.tags.find((t) => t[0] === 'subject');

  return {
    id: event.id,
    pubkey: event.pubkey,
    groupId,
    content: event.content,
    createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
    rootId: rootTag?.[1],
    parentId: parentTag?.[1],
    subject: subjectTag?.[1],
  };
}

export interface ThreadNode extends ThreadComment {
  replies: ThreadNode[];
  /** Nesting depth from the root, which is 0. */
  depth: number;
}

export interface Thread {
  root: ThreadComment;
  replies: ThreadNode[];
  /** Every reply beneath the root, at any depth. */
  replyCount: number;
  /** createdAt of the newest event anywhere in the thread, for sorting. */
  lastActivity: number;
}

const MAX_DEPTH = 8;

/**
 * Assemble flat comments into threads.
 *
 * Two properties matter more than the nesting itself:
 *
 * Replies whose parent is missing are re-attached to the thread root rather
 * than dropped. A relay can legitimately return a reply without its parent --
 * different retention, a deletion, or simply a paging boundary -- and silently
 * discarding it makes messages vanish with no indication anything is missing.
 * Showing it slightly misplaced is much better than showing nothing.
 *
 * Depth is capped rather than trusted. Parent links come from other clients and
 * can form a cycle, whether by malice or by a buggy writer; an uncapped
 * recursive walk would hang the render. Past the cap, replies flatten onto the
 * deepest rendered ancestor instead of disappearing.
 */
export function assembleThreads(comments: ThreadComment[]): Thread[] {
  const roots = comments.filter((c) => !c.rootId);
  const rootIds = new Set(roots.map((r) => r.id));

  // Bucket replies by the thread they belong to, so an unrelated reply cannot
  // pull an unrelated root into the list.
  const repliesByRoot = new Map<string, ThreadComment[]>();
  for (const comment of comments) {
    if (!comment.rootId || !rootIds.has(comment.rootId)) continue;
    const bucket = repliesByRoot.get(comment.rootId);
    if (bucket) bucket.push(comment);
    else repliesByRoot.set(comment.rootId, [comment]);
  }

  const threads: Thread[] = roots.map((root) => {
    const replies = repliesByRoot.get(root.id) ?? [];
    const byId = new Map(replies.map((r) => [r.id, r]));

    // Children keyed by parent. A reply pointing at a parent we do not have
    // falls back to the root.
    const childrenOf = new Map<string, ThreadComment[]>();
    for (const reply of replies) {
      const parent = reply.parentId && byId.has(reply.parentId) ? reply.parentId : root.id;
      const bucket = childrenOf.get(parent);
      if (bucket) bucket.push(reply);
      else childrenOf.set(parent, [reply]);
    }

    const seen = new Set<string>();

    function build(parentId: string, depth: number): ThreadNode[] {
      const children = childrenOf.get(parentId) ?? [];

      return children
        .filter((child) => {
          // Cycle guard. Without it a reply pair pointing at each other walks
          // forever.
          if (seen.has(child.id)) return false;
          seen.add(child.id);
          return true;
        })
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((child) => ({
          ...child,
          depth,
          replies: depth >= MAX_DEPTH ? [] : build(child.id, depth + 1),
        }));
    }

    const tree = build(root.id, 0);

    // Sweep up anything the walk never reached.
    //
    // The per-reply fallback above only catches a parent that is ABSENT. A
    // parent that is present but unreachable from the root -- a cycle, or a
    // chain hanging off one -- forms an island that the walk never enters, and
    // those replies would silently disappear. Same outcome the fallback exists
    // to prevent, arrived at by a different route, so it needs its own sweep
    // rather than a cleverer traversal.
    const unreached = replies.filter((r) => !seen.has(r.id));
    if (unreached.length > 0) {
      for (const reply of unreached) {
        seen.add(reply.id);
      }
      tree.push(
        ...unreached
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((reply) => ({ ...reply, depth: 0, replies: [] }))
      );
      tree.sort((a, b) => a.createdAt - b.createdAt);
    }

    const lastActivity = replies.reduce((max, r) => Math.max(max, r.createdAt), root.createdAt);

    return { root, replies: tree, replyCount: replies.length, lastActivity };
  });

  // Newest activity first: a thread someone just replied to is the one most
  // likely to be wanted, which is not the same as the newest thread.
  return threads.sort((a, b) => b.lastActivity - a.lastActivity);
}
