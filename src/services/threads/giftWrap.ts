/**
 * Kind 1059 gift-wrap construction and trial decryption.
 *
 * Wire format matches the kit's thread_wrap.py:
 *   message inner: JSON {"p": plaintext, "a": author_pubkey_hex}
 *   handoff inner: JSON {"tid": thread_id, "sec": secret_hex, "g": granter_hex}
 *   tags: [['t', bucket_hex], ['expiration', String((window+2)*86400)]]
 */

import { generateSecretKey, getPublicKey, nip44, finalizeEvent } from 'nostr-tools';
import { hexToBytes } from 'nostr-tools/utils';
import {
  computeThreadBucket,
  computeHandoffBucket,
  ecdhHex,
  getWindowId,
  jitteredTimestamp,
  expiryTimestamp,
} from './bucketCrypto';
import type { ThreadKeyStore } from './threadKeyStore';

export const GIFT_WRAP_KIND = 1059;

export interface UnwrappedMessage {
  plaintext: string;
  authorHex: string;
  threadId: string;
  wrapId: string;
}

export interface UnwrappedHandoff {
  threadId: string;
  threadSecretHex: string;
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
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const wid = getWindowId(now);
  const threadPubkey = getPublicKey(hexToBytes(threadSecretHex));

  const oneTimeSk = generateSecretKey();
  const conversationKey = nip44.v2.utils.getConversationKey(oneTimeSk, threadPubkey);
  const inner = JSON.stringify({ p: plaintext, a: authorPubkey });
  const encrypted = nip44.v2.encrypt(inner, conversationKey);

  const bucket = computeThreadBucket(threadSecretHex, wid);
  const expiry = expiryTimestamp(wid);

  return finalizeEvent(
    {
      kind: GIFT_WRAP_KIND,
      content: encrypted,
      tags: [['t', bucket], ['expiration', String(expiry)]],
      created_at: jitteredTimestamp(now),
    },
    oneTimeSk,
  );
}

/**
 * Try to unwrap a kind 1059 event as a thread message.
 * Trial-decrypts with each held thread key.
 */
export function tryUnwrapMessage(
  wrapEvent: { id: string; pubkey: string; content: string; tags: string[][] },
  keyStore: ThreadKeyStore,
): UnwrappedMessage | null {
  for (const [threadPubkey, threadSk] of keyStore.entries()) {
    try {
      const conversationKey = nip44.v2.utils.getConversationKey(threadSk, wrapEvent.pubkey);
      const decrypted = nip44.v2.decrypt(wrapEvent.content, conversationKey);
      const inner = JSON.parse(decrypted);

      if (typeof inner.p === 'string' && typeof inner.a === 'string') {
        return {
          plaintext: inner.p,
          authorHex: inner.a,
          threadId: threadPubkey,
          wrapId: wrapEvent.id,
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

  return finalizeEvent(
    {
      kind: GIFT_WRAP_KIND,
      content: encrypted,
      tags: [['t', bucket], ['expiration', String(expiry)]],
      created_at: jitteredTimestamp(now),
    },
    oneTimeSk,
  );
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
