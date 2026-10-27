/**
 * @fileoverview Private threads: the sealed ones whose key the user holds.
 *
 * The kit (arbiter thread_daemon.py) writes fleet threads in one of two
 * shapes, and signs neither with the fleet key:
 *  - wrap mode, the live one: kind 1059 under a one-time key, `t` bucket tag,
 *    content sealed to the thread key, inner {p: envelope, a: role pubkey}.
 *    These arrive through the bucket reader; see acceptWrapped.
 *  - legacy: kind:1111 signed by the sending ROLE's own key, content sealed to
 *    the thread key, clear tags d (thread id), K, thread (thread pubkey), and h
 *    only when the thread names a group. Fetched by `#d` and by group; see
 *    acceptStandalone.
 * There is no E tag, so a conversation is the set of messages sharing a thread
 * key, not a root and its replies.
 *
 * What may be shown is decided here, before anything is stored: only when the
 * user holds the thread's key AND the content opens with it. A message for a
 * key the user does not hold is dropped whole, so not even its tags are
 * stored, shown or counted. Unsealed threads are public and belong to
 * publicThreadList.ts; this module never shows one.
 */

import { THREAD_KIND } from './threadEvents';
import { decryptThreadContent, type ThreadKeyStore } from './threadKeyStore';
import { parseFleetEnvelope } from './fleetEnvelope';
import type { UnwrappedHandoff, UnwrappedMessage } from './giftWrap';
import { getPublicKey } from 'nostr-tools';
import { hexToBytes } from 'nostr-tools/utils';

export interface StandaloneMessage {
  id: string;
  pubkey: string;
  createdAt: number;
  /** True when createdAt is a wrap's randomised time, not the send time; see UnwrappedMessage. */
  approxTime?: boolean;
  /** Which conversation: `sealed:<thread pubkey>`. */
  threadKey: string;
  title: string;
  /** The readable text: a fleet envelope's body, or the plaintext itself. */
  text: string;
  /** The sender role a fleet envelope names; null otherwise. */
  from: string | null;
  sealed: boolean;
  /** The project the message is tagged with; null when there is none. */
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
  /** The newest message's time is approximate. */
  lastActivityApprox: boolean;
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

/** The sealed message, if the user may see it; null drops it entirely. */
export function acceptStandalone(event: RawEvent, ctx: { keyStore: ThreadKeyStore }): StandaloneMessage | null {
  if (event.kind !== THREAD_KIND) return null;

  const threadPk = tag(event, 'thread');
  if (!threadPk) return null;
  const sk = ctx.keyStore.get(threadPk);
  if (!sk) return null;
  const plaintext = decryptThreadContent(event.content, sk, event.pubkey);
  if (plaintext === null) return null;

  const envelope = parseFleetEnvelope(plaintext);
  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at ?? 0,
    threadKey: `sealed:${threadPk}`,
    title: tag(event, 'd') || envelope?.thread || tag(event, 'subject') || 'Sealed thread',
    text: envelope ? envelope.body : plaintext,
    from: envelope?.from ?? null,
    sealed: true,
    projectId: tag(event, 'h') ?? null,
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
    const root = msgs[0];
    threads.push({
      threadKey,
      title: root.title,
      sealed: msgs.some((m) => m.sealed),
      projectId: msgs.find((m) => m.projectId)?.projectId ?? null,
      messages: msgs,
      lastActivity: msgs[msgs.length - 1].createdAt,
      lastActivityApprox: msgs[msgs.length - 1].approxTime === true,
    });
  }
  return threads.sort((a, b) => b.lastActivity - a.lastActivity);
}

/**
 * A wrap-mode message (kind 1059), already opened by the bucket reader with a
 * held key. It joins the same conversation as that thread's kind:1111s.
 *
 * The key is checked again here because the reader's list outlives a key: one
 * signed out, or replaced by another key's, must take its messages with it.
 *
 * The author is what the sender wrote inside the encryption, not a signature:
 * the wrap is signed by a one-time key. Anyone holding the thread key can name
 * any author, which is the same trust the Sealed box already extends.
 */
export function acceptWrapped(
  msg: UnwrappedMessage,
  ctx: { keyStore: ThreadKeyStore; threadIds: Map<string, string> }
): StandaloneMessage | null {
  if (!ctx.keyStore.has(msg.threadId)) return null;
  const envelope = parseFleetEnvelope(msg.plaintext);
  return {
    id: msg.wrapId,
    pubkey: msg.authorHex,
    createdAt: msg.createdAt,
    approxTime: msg.approxTime,
    threadKey: `sealed:${msg.threadId}`,
    title: ctx.threadIds.get(msg.threadId) || envelope?.thread || 'Sealed thread',
    text: envelope ? envelope.body : msg.plaintext,
    from: envelope?.from ?? null,
    sealed: true,
    projectId: null,
  };
}

/**
 * Thread pubkey to the kit's thread id, from the sealed hand-offs. The id is
 * the kind:1111 `d` tag, the one way to ask a relay for a thread's messages
 * whoever signed them. The kind 24242 hand-off carries no id (its `d` is the
 * thread pubkey), so a key that arrived only that way has no entry here.
 */
export function threadIdsFromHandoffs(handoffs: UnwrappedHandoff[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const h of handoffs) {
    try {
      out.set(getPublicKey(hexToBytes(h.threadSecretHex)), h.threadId);
    } catch {
      // A malformed secret names nothing.
    }
  }
  return out;
}
