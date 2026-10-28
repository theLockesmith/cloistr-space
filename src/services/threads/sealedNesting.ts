/**
 * @fileoverview Reddit-style nesting for private (sealed) threads.
 *
 * A v2 sealed message carries NIP-22 tags inside its rumor; a reply's `e`
 * points at its parent's RUMOR id (architecture/threads.md section 3). A
 * private conversation has no root event to hang the tree from -- it is every
 * message under one thread key -- so the top level is every message with no
 * parent here, and this sits beside assembleThreads rather than inside it.
 *
 * The same two rules as the public tree hold: a reply whose parent is missing
 * is shown at the top level, never dropped, and depth is capped rather than
 * trusted, with a sweep for cycles the walk never enters.
 *
 * Pure: no React, no NDK.
 */

import type { StandaloneMessage } from './standaloneThreads';

/** Same cap as the public tree (threadEvents.ts). */
const MAX_DEPTH = 8;

export interface MessageNode extends StandaloneMessage {
  /** 0 at the top level. */
  depth: number;
  replies: MessageNode[];
}

const byTime = (a: StandaloneMessage, b: StandaloneMessage) => a.createdAt - b.createdAt;

export function nestMessages(messages: StandaloneMessage[]): MessageNode[] {
  // One message per rumor: the kit may send the same sealed message in more
  // than one wrap. v1 messages have no rumor id and are kept as they are.
  const unique: StandaloneMessage[] = [];
  const byRumor = new Map<string, StandaloneMessage>();
  for (const m of messages) {
    if (m.rumorId) {
      if (byRumor.has(m.rumorId)) continue;
      byRumor.set(m.rumorId, m);
    }
    unique.push(m);
  }

  const TOP = '';
  const childrenOf = new Map<string, StandaloneMessage[]>();
  for (const m of unique) {
    const parent = m.parentId && m.parentId !== m.rumorId && byRumor.has(m.parentId) ? m.parentId : TOP;
    const bucket = childrenOf.get(parent);
    if (bucket) bucket.push(m);
    else childrenOf.set(parent, [m]);
  }

  const seen = new Set<StandaloneMessage>();

  // Past the cap, a node's whole subtree is flattened onto it at the cap
  // depth instead of being cut off.
  function subtree(m: StandaloneMessage): StandaloneMessage[] {
    const out: StandaloneMessage[] = [];
    for (const child of (m.rumorId && childrenOf.get(m.rumorId)) || []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child, ...subtree(child));
    }
    return out;
  }

  function build(parent: string, depth: number): MessageNode[] {
    return (childrenOf.get(parent) ?? [])
      .filter((child) => {
        if (seen.has(child)) return false;
        seen.add(child);
        return true;
      })
      .sort(byTime)
      .map((child) => {
        if (depth >= MAX_DEPTH) {
          const flat = subtree(child).sort(byTime);
          return { ...child, depth, replies: [] as MessageNode[], flat };
        }
        return { ...child, depth, replies: child.rumorId ? build(child.rumorId, depth + 1) : [] };
      })
      .flatMap(({ flat, ...node }: MessageNode & { flat?: StandaloneMessage[] }) => [
        node,
        ...(flat ?? []).map((m) => ({ ...m, depth, replies: [] })),
      ]);
  }

  const tree = build(TOP, 0);

  // A parent that is present but unreachable from the top -- a cycle -- is an
  // island the walk never enters. Show it at the top level rather than lose it.
  const unreached = unique.filter((m) => !seen.has(m)).sort(byTime);
  if (unreached.length > 0) {
    tree.push(...unreached.map((m) => ({ ...m, depth: 0, replies: [] })));
    tree.sort(byTime);
  }
  return tree;
}
