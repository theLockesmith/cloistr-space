/**
 * @fileoverview NIP-10 reply threading for kind:1 notes.
 *
 * WHICH CONVENTION, AND WHY -- because there are two and drifting between them
 * is worse than picking the wrong one.
 *
 *   WE WRITE: kind:1 with NIP-10 `e` tag markers ("root" / "reply").
 *   WE READ:  NIP-10 kind:1 replies AND NIP-22 kind:1111 comments.
 *
 * The line is the TARGET's kind, not our preference. NIP-22 kind:1111 exists
 * for commenting on non-kind:1 content, which is why the NIP-29 group threads
 * in services/threads use it. But a reply to a kind:1 note written as kind:1111
 * would be invisible to every client that reads NIP-10 -- which is all of the
 * ones people actually use. Writing the older convention costs us nothing and
 * keeps our replies visible; reading both costs one extra filter and catches
 * clients that have moved on.
 *
 * NIP-10's deprecated positional form (untagged `e` entries where the first is
 * the root and the last is the reply) is still what a lot of stored events
 * look like, so parsing handles it. We never emit it.
 */

export const NOTE_KIND = 1;
export const COMMENT_KIND = 1111;

export interface ReplyTarget {
  /** Event being replied to directly. */
  id: string;
  /** Author of that event, so they get a `p` tag. */
  pubkey: string;
  /** Root of the thread, if the target is itself a reply. */
  rootId?: string;
  /** Relay hint for the target, carried through from where we found it. */
  relay?: string;
}

/**
 * Build the tags for a NIP-10 reply.
 *
 * Both markers are emitted even when replying directly to a root, because a
 * client reading only the "reply" marker still needs the root to place it, and
 * a client reading only "root" still needs to know what it answers.
 */
export function buildReplyTags(target: ReplyTarget, mentionPubkeys: string[] = []): string[][] {
  const rootId = target.rootId ?? target.id;
  const hint = target.relay ?? '';

  const tags: string[][] = [['e', rootId, hint, 'root']];

  // Only when the target is not itself the root -- a "reply" marker pointing at
  // the same id as "root" is noise that some clients render as self-reference.
  if (rootId !== target.id) {
    tags.push(['e', target.id, hint, 'reply']);
  }

  // The author of what we are answering, plus anyone carried forward from the
  // thread. Deduped: a `p` tag repeated is a notification repeated.
  const seen = new Set<string>();
  for (const pubkey of [target.pubkey, ...mentionPubkeys]) {
    if (!pubkey || seen.has(pubkey)) continue;
    seen.add(pubkey);
    tags.push(['p', pubkey]);
  }

  return tags;
}

export interface ParsedReply {
  /** The event this directly answers, if any. */
  replyTo?: string;
  /** The thread root, if any. */
  root?: string;
}

/**
 * Read NIP-10 `e` tags, marked or positional.
 *
 * Marked form wins when present. The positional fallback exists because a large
 * share of stored replies predate markers, and treating those as top-level
 * notes would silently flatten old threads.
 */
export function parseReplyTags(tags: string[][]): ParsedReply {
  const eTags = tags.filter((t) => t[0] === 'e' && typeof t[1] === 'string');
  if (eTags.length === 0) return {};

  const marked = eTags.filter((t) => t[3] === 'root' || t[3] === 'reply');

  if (marked.length > 0) {
    const root = marked.find((t) => t[3] === 'root')?.[1];
    const reply = marked.find((t) => t[3] === 'reply')?.[1];
    // A lone root marker means this answers the root directly.
    return { root, replyTo: reply ?? root };
  }

  // Deprecated positional form: first e tag is the root, last is what is being
  // replied to. With exactly one, they are the same event.
  const first = eTags[0][1];
  const last = eTags[eTags.length - 1][1];
  return { root: first, replyTo: last };
}

/** NIP-22 kind:1111 points at its parent with `e`/`E` (lowercase = immediate). */
export function parseCommentTags(tags: string[][]): ParsedReply {
  const parent = tags.find((t) => t[0] === 'e' && typeof t[1] === 'string')?.[1];
  const root = tags.find((t) => t[0] === 'E' && typeof t[1] === 'string')?.[1];
  return { replyTo: parent ?? root, root: root ?? parent };
}

export interface ThreadNode<T> {
  event: T;
  children: ThreadNode<T>[];
  depth: number;
}

interface Threadable {
  id: string;
  createdAt: number;
  replyTo?: string;
}

/**
 * Assemble replies into a tree under `rootId`.
 *
 * Two hazards, both of which have bitten the group-thread version of this:
 *
 * A CYCLE. Malicious or corrupt events can reference each other, and a naive
 * recursive walk never returns. Depth is bounded and visited ids are tracked.
 *
 * ORPHANS. A reply whose parent we never received would silently vanish. They
 * are attached to the root instead, because showing a reply slightly out of
 * place is better than losing it -- the user can see there IS a response.
 */
export function assembleReplies<T extends Threadable>(
  rootId: string,
  replies: T[],
  maxDepth = 6
): ThreadNode<T>[] {
  const byParent = new Map<string, T[]>();
  const known = new Set(replies.map((r) => r.id));
  known.add(rootId);

  for (const reply of replies) {
    // An unreachable parent means the reply would disappear. Reparent to root.
    const parent = reply.replyTo && known.has(reply.replyTo) ? reply.replyTo : rootId;
    const bucket = byParent.get(parent);
    if (bucket) bucket.push(reply);
    else byParent.set(parent, [reply]);
  }

  const visited = new Set<string>();

  const build = (parentId: string, depth: number): ThreadNode<T>[] => {
    if (depth > maxDepth) return [];

    const children = byParent.get(parentId) ?? [];
    const nodes: ThreadNode<T>[] = [];

    for (const child of [...children].sort((a, b) => a.createdAt - b.createdAt)) {
      // The cycle guard. Without it, two events referencing each other recurse
      // until the stack gives out.
      if (visited.has(child.id)) continue;
      visited.add(child.id);

      nodes.push({ event: child, children: build(child.id, depth + 1), depth });
    }

    return nodes;
  };

  return build(rootId, 0);
}
