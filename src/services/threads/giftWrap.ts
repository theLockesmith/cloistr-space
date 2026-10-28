/**
 * Kind 1059 gift-wrap construction and trial decryption.
 *
 * Wire format matches the kit's thread_wrap.py:
 *   message inner, v2 (kit seal-author-v2): a kind 13 seal signed by the author,
 *     its content NIP-44(author -> thread pubkey, rumor JSON), the rumor
 *     {pubkey, created_at, kind, tags, content}. Read; Space does not write it yet.
 *   message inner, v1: JSON {"p": plaintext, "a": author_pubkey_hex, "ts": sent_at_unix}
 *     (`ts` added 2026-10-19). Still read, and still what Space writes.
 *   handoff inner: JSON {"tid": thread_id, "sec": secret_hex, "g": granter_hex}
 *   tags: [['t', bucket_hex], ['expiration', String((window+2)*86400)]]
 */

import { generateSecretKey, getEventHash, getPublicKey, nip44, finalizeEvent, type Event } from 'nostr-tools';
import { verifyFresh } from '../nostr/verifyFresh';
import { hexToBytes } from 'nostr-tools/utils';
import {
  computeThreadBucket,
  computeHandoffBucket,
  ecdhHex,
  getWindowId,
  jitteredTimestamp,
  expiryTimestamp,
  WINDOW_SECONDS,
} from './bucketCrypto';
import type { ThreadKeyStore } from './threadKeyStore';

export const GIFT_WRAP_KIND = 1059;

export interface UnwrappedMessage {
  plaintext: string;
  authorHex: string;
  threadId: string;
  wrapId: string;
  /**
   * When the message was sent: the `ts` sealed inside it. Without a usable one
   * the send time is only known to lie between the wrap's created_at (randomised
   * back toward its window's start) and the window's end or now, whichever is
   * sooner; createdAt is then that LATEST bound, and approxTime says so. The
   * latest, because the earliest can be the evening before in local time, and
   * an untimed message must never sort above timed ones sent after it.
   */
  createdAt: number;
  approxTime: boolean;
  /**
   * True only for a v2 message: authorHex signed the seal, and the rumor inside
   * names the same key. A v1 message's author is whatever its sender typed.
   */
  verified: boolean;
  /**
   * v2 only: the rumor's NIP-01 id, which is what a reply's `e` tag points at
   * (architecture/threads.md section 3). Computed here, never read from the
   * rumor, so a sender cannot claim another message's id. Absent when the
   * rumor's fields do not hash, and on every v1 message.
   */
  rumorId?: string;
  /** v2 only: the immediate parent, the rumor's first lowercase `e` tag. */
  parentId?: string;
  /** v2 only: the thread root, the rumor's first uppercase `E` tag. */
  rootId?: string;
}

export const SEAL_KIND = 13;

const EVENT_FIELDS = ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'] as const;

type SealVerdict =
  | { kind: 'notSeal' }
  | { kind: 'foreign' }
  | { kind: 'refused' }
  | { kind: 'ok'; plaintext: string; authorHex: string; sentAt: unknown; links: RumorLinks };

interface RumorLinks {
  rumorId?: string;
  parentId?: string;
  rootId?: string;
}

/** The rumor's id and NIP-22 pointers, or none of them when its fields cannot be hashed. */
function rumorLinks(r: { pubkey: string; content: string; created_at?: unknown; kind?: unknown; tags?: unknown }): RumorLinks {
  const tags = r.tags;
  if (
    typeof r.created_at !== 'number' ||
    typeof r.kind !== 'number' ||
    !Array.isArray(tags) ||
    !tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))
  ) {
    return {};
  }
  const pointer = (name: string) => {
    const v = (tags as string[][]).find((t) => t[0] === name)?.[1];
    return v && /^[0-9a-f]{64}$/.test(v) ? v : undefined;
  };
  try {
    const rumorId = getEventHash({ pubkey: r.pubkey, created_at: r.created_at, kind: r.kind, tags: tags as string[][], content: r.content });
    return { rumorId, parentId: pointer('e'), rootId: pointer('E') };
  } catch {
    return {};
  }
}

/**
 * Open a v2 seal with a thread key, as the kit's _verify_seal_json does.
 *
 * `refused` is a forgery or corruption addressed to this thread (the wrap
 * opened with its key), so nothing of it may be shown. `foreign` is a valid
 * seal for someone else; `notSeal` means try the v1 shape.
 */
function openSeal(inner: unknown, threadSk: Uint8Array): SealVerdict {
  if (!inner || typeof inner !== 'object' || !EVENT_FIELDS.every((f) => f in inner)) return { kind: 'notSeal' };
  const seal = inner as Event;
  if (seal.kind !== SEAL_KIND || typeof seal.pubkey !== 'string' || !verifyFresh(seal)) return { kind: 'refused' };

  let rumor: unknown;
  try {
    rumor = nip44.v2.decrypt(seal.content, nip44.v2.utils.getConversationKey(threadSk, seal.pubkey));
  } catch {
    return { kind: 'foreign' };
  }
  try {
    rumor = JSON.parse(rumor as string);
  } catch {
    return { kind: 'refused' };
  }
  const r = rumor as { pubkey?: unknown; content?: unknown; created_at?: unknown; kind?: unknown; tags?: unknown };
  // NIP-59's anti-impersonation rule: the rumor's claimed author must be the
  // key that signed the seal around it.
  if (typeof r.pubkey !== 'string' || r.pubkey.toLowerCase() !== seal.pubkey.toLowerCase()) return { kind: 'refused' };
  if (typeof r.content !== 'string') return { kind: 'refused' };
  return {
    kind: 'ok',
    plaintext: r.content,
    authorHex: seal.pubkey.toLowerCase(),
    sentAt: r.created_at,
    links: rumorLinks({ ...r, pubkey: r.pubkey, content: r.content }),
  };
}

/**
 * The sealed send time, if it is consistent with the wrap around it. Nothing
 * signs `ts`, so it is only checked against what the wrap proves: the
 * randomised created_at is never later than the send and always in the same
 * window.
 */
function sealedSendTime(ts: unknown, wrapCreatedAt: number | undefined): number | null {
  if (typeof ts !== 'number' || !Number.isSafeInteger(ts) || wrapCreatedAt === undefined) return null;
  if (ts < wrapCreatedAt || getWindowId(ts) !== getWindowId(wrapCreatedAt)) return null;
  return ts;
}

export interface UnwrappedHandoff {
  threadId: string;
  threadSecretHex: string;
  /**
   * The granter the payload CLAIMS. Nothing signs it: the wrap is signed by a
   * throwaway key, so anyone can put any pubkey here. Never treat it as who
   * sent the key.
   */
  granterPubkey: string;
  wrapId: string;
}

/**
 * Wrap a thread message as a kind 1059 gift-wrapped event.
 *
 * @param plaintext       The message text
 * @param authorPubkey    The real author's pubkey (hex)
 * @param threadSecretHex The thread's secret key as hex
 * @param nowSec          Current timestamp in seconds (defaults to now)
 */
export function wrapThreadMessage(
  plaintext: string,
  authorPubkey: string,
  threadSecretHex: string,
  nowSec?: number,
): ReturnType<typeof finalizeEvent> {
  return wrapThreadMessageWithKey(plaintext, authorPubkey, threadSecretHex, nowSec).event;
}

/** A wrap and the one-time key that signed it: publishing signs in to the relay as that key. */
export interface SignedWrap {
  event: ReturnType<typeof finalizeEvent>;
  oneTimeSk: Uint8Array;
}

export function wrapThreadMessageWithKey(
  plaintext: string,
  authorPubkey: string,
  threadSecretHex: string,
  nowSec?: number,
): SignedWrap {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const wid = getWindowId(now);
  const threadPubkey = getPublicKey(hexToBytes(threadSecretHex));

  const oneTimeSk = generateSecretKey();
  const conversationKey = nip44.v2.utils.getConversationKey(oneTimeSk, threadPubkey);
  const inner = JSON.stringify({ p: plaintext, a: authorPubkey, ts: now });
  const encrypted = nip44.v2.encrypt(inner, conversationKey);

  const bucket = computeThreadBucket(threadSecretHex, wid);
  const expiry = expiryTimestamp(wid);

  const event = finalizeEvent(
    {
      kind: GIFT_WRAP_KIND,
      content: encrypted,
      tags: [['t', bucket], ['expiration', String(expiry)]],
      created_at: jitteredTimestamp(now),
    },
    oneTimeSk,
  );
  return { event, oneTimeSk };
}

/**
 * Try to unwrap a kind 1059 event as a thread message.
 * Trial-decrypts with each held thread key.
 */
/** The latest the message in a wrap made at `wrapCreatedAt` can have been sent, as of `nowSec`. */
function latestSendTime(wrapCreatedAt: number, nowSec: number): number {
  const windowEnd = (getWindowId(wrapCreatedAt) + 1) * WINDOW_SECONDS - 1;
  return Math.max(wrapCreatedAt, Math.min(windowEnd, nowSec));
}

export function tryUnwrapMessage(
  wrapEvent: { id: string; pubkey: string; content: string; tags: string[][]; created_at?: number },
  keyStore: ThreadKeyStore,
  nowSec: number = Math.floor(Date.now() / 1000),
): UnwrappedMessage | null {
  for (const [threadPubkey, threadSk] of keyStore.entries()) {
    try {
      const conversationKey = nip44.v2.utils.getConversationKey(threadSk, wrapEvent.pubkey);
      const decrypted = nip44.v2.decrypt(wrapEvent.content, conversationKey);
      const inner = JSON.parse(decrypted);
      const time = (ts: unknown) => {
        const sentAt = sealedSendTime(ts, wrapEvent.created_at);
        return {
          createdAt: sentAt ?? (wrapEvent.created_at === undefined ? 0 : latestSendTime(wrapEvent.created_at, nowSec)),
          approxTime: sentAt === null,
        };
      };

      const seal = openSeal(inner, threadSk);
      if (seal.kind === 'refused') return null;
      if (seal.kind === 'ok') {
        // The rumor's created_at is the real send time, and the seal's
        // signature covers it.
        return {
          plaintext: seal.plaintext,
          authorHex: seal.authorHex,
          threadId: threadPubkey,
          wrapId: wrapEvent.id,
          ...time(seal.sentAt),
          verified: true,
          ...seal.links,
        };
      }
      if (seal.kind === 'notSeal' && typeof inner.p === 'string' && typeof inner.a === 'string') {
        return {
          plaintext: inner.p,
          authorHex: inner.a,
          threadId: threadPubkey,
          wrapId: wrapEvent.id,
          ...time(inner.ts),
          verified: false,
        };
      }
    } catch {
      // Wrong key or not a message. Try the next.
    }
  }
  return null;
}

/**
 * Wrap a thread key handoff as a kind 1059 gift-wrapped event.
 *
 * @param threadId         Application-level thread identifier
 * @param threadSecretHex  The thread's secret key to hand off (hex)
 * @param granterSk        The granter's secret key (for ECDH bucket computation)
 * @param memberPubkey     The new member's public key (hex)
 * @param nowSec           Current timestamp in seconds (defaults to now)
 */
export function wrapKeyHandoff(
  threadId: string,
  threadSecretHex: string,
  granterSk: Uint8Array,
  memberPubkey: string,
  nowSec?: number,
): ReturnType<typeof finalizeEvent> {
  return wrapKeyHandoffWithKey(threadId, threadSecretHex, granterSk, memberPubkey, nowSec).event;
}

export function wrapKeyHandoffWithKey(
  threadId: string,
  threadSecretHex: string,
  granterSk: Uint8Array,
  memberPubkey: string,
  nowSec?: number,
): SignedWrap {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const wid = getWindowId(now);
  const granterPubkey = getPublicKey(granterSk);

  const ecdh = ecdhHex(granterSk, memberPubkey);
  const bucket = computeHandoffBucket(ecdh, wid);
  const expiry = expiryTimestamp(wid);

  const oneTimeSk = generateSecretKey();
  const conversationKey = nip44.v2.utils.getConversationKey(oneTimeSk, memberPubkey);
  const payload = JSON.stringify({ tid: threadId, sec: threadSecretHex, g: granterPubkey });
  const encrypted = nip44.v2.encrypt(payload, conversationKey);

  const event = finalizeEvent(
    {
      kind: GIFT_WRAP_KIND,
      content: encrypted,
      tags: [['t', bucket], ['expiration', String(expiry)]],
      created_at: jitteredTimestamp(now),
    },
    oneTimeSk,
  );
  return { event, oneTimeSk };
}

/**
 * Try to unwrap a kind 1059 event as a key handoff.
 *
 * @param wrapEvent         The kind 1059 event
 * @param recipientSecret   The recipient's secret key
 * @param expectedGranters  If provided, reject handoffs from unknown granters
 */
/**
 * Validate a decrypted hand-off payload ({tid, sec, g}, the kit's format).
 * Shared by the local-key path and the signer path, so both apply the same
 * checks, including that the granter is one we expect.
 */
export function parseHandoffPayload(
  decrypted: string,
  wrapId: string,
  expectedGranters?: string[],
): UnwrappedHandoff | null {
  try {
    const payload = JSON.parse(decrypted);
    if (
      typeof payload.tid === 'string' &&
      typeof payload.sec === 'string' &&
      typeof payload.g === 'string' &&
      /^[0-9a-f]{64}$/i.test(payload.sec)
    ) {
      // Filters noise only: `g` is the sender's own claim, so this proves nothing.
      if (expectedGranters && !expectedGranters.includes(payload.g)) return null;
      return {
        threadId: payload.tid,
        threadSecretHex: payload.sec,
        granterPubkey: payload.g,
        wrapId,
      };
    }
  } catch {
    // Not JSON: not a hand-off.
  }
  return null;
}

export function tryUnwrapHandoff(
  wrapEvent: { id: string; pubkey: string; content: string },
  recipientSecret: Uint8Array,
  expectedGranters?: string[],
): UnwrappedHandoff | null {
  try {
    const conversationKey = nip44.v2.utils.getConversationKey(
      recipientSecret,
      wrapEvent.pubkey,
    );
    const decrypted = nip44.v2.decrypt(wrapEvent.content, conversationKey);
    return parseHandoffPayload(decrypted, wrapEvent.id, expectedGranters);
  } catch {
    // Not a handoff for us.
    return null;
  }
}
