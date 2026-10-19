/**
 * @fileoverview Threads that stand alone: no project tag, or a project the
 * user is not in.
 *
 * The operator ruled (2026-10-13) that a thread is a thread whether or not a
 * project holds it; the project is a reference, not a container. The fleet
 * writes exactly these: every message is a standalone kind:1111, sealed to the
 * thread's key, with clear tags d (thread name), K and thread (thread pubkey),
 * and h only when the thread names a group (arbiter thread_daemon.py). There
 * is no E tag, so a conversation is the set of messages sharing a thread tag,
 * not a root and its replies.
 *
 * What may be shown is decided here, before anything is stored:
 *  - sealed: only when the user holds the thread's key AND the content opens
 *    with it. A message for a key the user does not hold is dropped whole, so
 *    not even its tags are stored, shown or counted.
 *  - unsealed: only the user's own messages. Public standalone threads from
 *    people the user follows or trusts are the next step, not this one.
 *  - anything tagged with a project the user IS in is left to the project
 *    path, which already shows it.
 */

import { THREAD_KIND } from './threadEvents';
import { decryptThreadContent, type ThreadKeyStore } from './threadKeyStore';
import { parseFleetEnvelope } from './fleetEnvelope';

export interface StandaloneMessage {
  id: string;
  pubkey: string;
  createdAt: number;
  /** Which conversation: `sealed:<thread pubkey>` or `root:<root event id>`. */
  threadKey: string;
  title: string;
  /** The readable text: a fleet envelope's body, or the plaintext itself. */
  text: string;
  /** The sender role a fleet envelope names; null otherwise. */
  from: string | null;
  sealed: boolean;
  /** The project tag, when it names one the user is not in; null when there is none. */
  projectId: string | null;
}

export interface StandaloneThread {
  threadKey: string;
  title: string;
  sealed: boolean;
  projectId: string | null;
  /** Oldest first. */
  messages: StandaloneMessage[];
  lastActivity: number;
}

interface RawEvent {
  id: string;
  kind?: number;
  pubkey: string;
  created_at?: number;
  content: string;
  tags: string[][];
}

const tag = (e: RawEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1];

/** The message, if the user may see it; null drops it entirely. */
export function acceptStandalone(
  event: RawEvent,
  ctx: { keyStore: ThreadKeyStore; me: string | null; memberProjects: Set<string> }
): StandaloneMessage | null {
  if (event.kind !== THREAD_KIND) return null;

  const h = tag(event, 'h') ?? null;
  if (h && ctx.memberProjects.has(h)) return null;

  const createdAt = event.created_at ?? 0;
  const threadPk = tag(event, 'thread');

  if (threadPk) {
    const sk = ctx.keyStore.get(threadPk);
    if (!sk) return null;
    const plaintext = decryptThreadContent(event.content, sk, event.pubkey);
    if (plaintext === null) return null;
    const envelope = parseFleetEnvelope(plaintext);
    return {
      id: event.id,
      pubkey: event.pubkey,
      createdAt,
      threadKey: `sealed:${threadPk}`,
      title: tag(event, 'd') || envelope?.thread || tag(event, 'subject') || 'Sealed thread',
      text: envelope ? envelope.body : plaintext,
      from: envelope?.from ?? null,
      sealed: true,
      projectId: h,
    };
  }

  // With no one signed in, me is null and no event's pubkey matches it.
  if (event.pubkey !== ctx.me) return null;
  const rootId = tag(event, 'E');
  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt,
    threadKey: `root:${rootId ?? event.id}`,
    title: tag(event, 'subject') || event.content.slice(0, 80) || 'Untitled thread',
    text: event.content,
    from: null,
    sealed: false,
    projectId: h,
  };
}

/** One conversation per thread: messages oldest first, conversations newest first. */
export function groupStandalone(messages: StandaloneMessage[]): StandaloneThread[] {
  const byThread = new Map<string, Map<string, StandaloneMessage>>();
  for (const m of messages) {
    const bucket = byThread.get(m.threadKey) ?? new Map<string, StandaloneMessage>();
    bucket.set(m.id, m);
    byThread.set(m.threadKey, bucket);
  }

  const threads: StandaloneThread[] = [];
  for (const [threadKey, bucket] of byThread) {
    const msgs = Array.from(bucket.values()).sort((a, b) => a.createdAt - b.createdAt);
    // A root's own subject names the conversation; replies only fall back to it.
    const root = msgs.find((m) => threadKey === `root:${m.id}`) ?? msgs[0];
    threads.push({
      threadKey,
      title: root.title,
      sealed: msgs.some((m) => m.sealed),
      projectId: msgs.find((m) => m.projectId)?.projectId ?? null,
      messages: msgs,
      lastActivity: msgs[msgs.length - 1].createdAt,
    });
  }
  return threads.sort((a, b) => b.lastActivity - a.lastActivity);
}
