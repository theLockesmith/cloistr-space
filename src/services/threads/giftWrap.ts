/**
 * @fileoverview Kind 1059 gift-wrap construction and trial decryption.
 *
 * A thread message is the author's signed event, NIP-44 encrypted to the
 * thread's key, wrapped in a kind 1059 event signed by a fresh random key.
 * The only tag on the wrap is a deliberately crowded bucket tag.
 *
 * Trial decryption: the reader downloads everything in its bucket set and
 * tries each held thread key against each wrap. Whatever opens is theirs.
 * This is local and cheap; download is the real cost.
 */

import { generateSecretKey, getPublicKey, nip44, finalizeEvent } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';
import {
  computeThreadBucket,
  computeHandoffBucket,
  getWindowId,
  bucketToTag,
  jitteredTimestamp,
} from './bucketCrypto';
import type { ThreadKeyStore } from './threadKeyStore';

export const GIFT_WRAP_KIND = 1059;

/**
 * The inner event carried inside a gift wrap. This is what the author
 * actually wrote, visible only to holders of the thread key.
 */
export interface ThreadRumor {
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
}

/**
 * Result of successfully unwrapping a gift-wrapped thread message.
 */
export interface UnwrappedMessage {
  /** The decrypted inner event */
  rumor: ThreadRumor;
  /** Which thread key opened it */
  threadPubkey: string;
  /** The wrap event's id (for deduplication) */
  wrapId: string;
}

/**
 * Result of successfully unwrapping a key handoff.
 */
export interface UnwrappedHandoff {
  threadPubkey: string;
  threadSecretHex: string;
  /** The wrap event's id */
  wrapId: string;
}

/**
 * Wrap a thread message as a kind 1059 gift-wrapped event.
 *
 * The returned event is fully signed with the one-time key and ready to
 * publish. The caller does NOT sign it again with their own signer.
 *
 * @param rumor          The inner event (author's content, kind, tags)
 * @param threadSecret   The thread's 32-byte secret key
 * @param windowId       Explicit window, or current window
 * @returns A signed kind 1059 event ready for relay submission
 */
export function wrapThreadMessage(
  rumor: ThreadRumor,
  threadSecret: Uint8Array,
  windowId?: number,
): ReturnType<typeof finalizeEvent> {
  const wid = windowId ?? getWindowId();
  const threadPubkey = getPublicKey(threadSecret);

  // Fresh one-time keypair, used only for this wrap
  const oneTimeSk = generateSecretKey();

  // Encrypt the rumor to the thread key.
  // Conversation key = ECDH(oneTimeSk, threadPubkey).
  // The reader reverses this with ECDH(threadSk, oneTimePubkey).
  const conversationKey = nip44.v2.utils.getConversationKey(oneTimeSk, threadPubkey);
  const encrypted = nip44.v2.encrypt(JSON.stringify(rumor), conversationKey);

  // Compute bucket for this thread + window
  const bucket = computeThreadBucket(threadSecret, wid);

  // Build and sign with the one-time key
  return finalizeEvent(
    {
      kind: GIFT_WRAP_KIND,
      content: encrypted,
      tags: [['bucket', bucketToTag(bucket)]],
      created_at: jitteredTimestamp(wid),
    },
    oneTimeSk,
  );
}

/**
 * Try to unwrap a kind 1059 event as a thread message.
 *
 * Tries each held thread key in turn. Returns the first successful
 * decryption, or null if no key opens it (the wrap is for a thread
 * the reader is not a member of, or it is a handoff, not a message).
 *
 * @param wrapEvent  A kind 1059 event from the relay
 * @param keyStore   The reader's thread key store
 * @returns The unwrapped message, or null
 */
export function tryUnwrapMessage(
  wrapEvent: { id: string; pubkey: string; content: string; tags: string[][] },
  keyStore: ThreadKeyStore,
): UnwrappedMessage | null {
  // Try each held thread key
  for (const [threadPubkey, threadSk] of keyStore.entries()) {
    try {
      const conversationKey = nip44.v2.utils.getConversationKey(threadSk, wrapEvent.pubkey);
      const decrypted = nip44.v2.decrypt(wrapEvent.content, conversationKey);
      const rumor = JSON.parse(decrypted) as ThreadRumor;

      // Sanity check: the inner event must have a pubkey and content
      if (rumor.pubkey && rumor.content !== undefined) {
        return { rumor, threadPubkey, wrapId: wrapEvent.id };
      }
    } catch {
      // This key did not open this wrap. Try the next one.
    }
  }

  return null;
}

/**
 * Wrap a thread key handoff as a kind 1059 gift-wrapped event.
 *
 * The handoff contains the thread's secret key, encrypted to the
 * recipient's pubkey, and bucketed by the ECDH shared secret between
 * granter and recipient so only they can find it.
 *
 * @param threadSecret     The thread's 32-byte secret key to hand off
 * @param granterSecret    The granter's 32-byte secret key (for ECDH bucket + encryption)
 * @param recipientPubkey  The new member's public key (hex)
 * @param windowId         Explicit window, or current window
 */
export function wrapKeyHandoff(
  threadSecret: Uint8Array,
  granterSecret: Uint8Array,
  recipientPubkey: string,
  windowId?: number,
): ReturnType<typeof finalizeEvent> {
  const wid = windowId ?? getWindowId();
  const threadPubkey = getPublicKey(threadSecret);

  // ECDH between granter and recipient for the bucket
  const ecdhShared = nip44.v2.utils.getConversationKey(granterSecret, recipientPubkey);
  const bucket = computeHandoffBucket(ecdhShared, wid);

  // Fresh one-time key for the wrap
  const oneTimeSk = generateSecretKey();

  // Encrypt the thread key to the recipient.
  // Uses ECDH(oneTimeSk, recipientPubkey) so the recipient can decrypt
  // with ECDH(recipientSk, oneTimePubkey).
  const payload = JSON.stringify({
    threadPubkey,
    threadSecret: bytesToHex(threadSecret),
    type: 'thread-key-handoff',
  });

  const conversationKey = nip44.v2.utils.getConversationKey(oneTimeSk, recipientPubkey);
  const encrypted = nip44.v2.encrypt(payload, conversationKey);

  return finalizeEvent(
    {
      kind: GIFT_WRAP_KIND,
      content: encrypted,
      tags: [['bucket', bucketToTag(bucket)]],
      created_at: jitteredTimestamp(wid),
    },
    oneTimeSk,
  );
}

/**
 * Try to unwrap a kind 1059 event as a key handoff.
 *
 * Uses the recipient's secret key to attempt decryption. Returns the
 * thread key if successful, null otherwise.
 *
 * For NIP-46 signers that do not expose the raw secret key, the caller
 * must use signer.nip44Decrypt instead and parse the result manually.
 *
 * @param wrapEvent       A kind 1059 event from the relay
 * @param recipientSecret The recipient's 32-byte secret key
 */
export function tryUnwrapHandoff(
  wrapEvent: { id: string; pubkey: string; content: string },
  recipientSecret: Uint8Array,
): UnwrappedHandoff | null {
  try {
    const conversationKey = nip44.v2.utils.getConversationKey(
      recipientSecret,
      wrapEvent.pubkey,
    );
    const decrypted = nip44.v2.decrypt(wrapEvent.content, conversationKey);
    const payload = JSON.parse(decrypted);

    if (
      payload.type === 'thread-key-handoff' &&
      payload.threadPubkey &&
      payload.threadSecret &&
      /^[0-9a-f]{64}$/i.test(payload.threadSecret)
    ) {
      return {
        threadPubkey: payload.threadPubkey,
        threadSecretHex: payload.threadSecret,
        wrapId: wrapEvent.id,
      };
    }
  } catch {
    // Not a handoff for us, or not a handoff at all.
  }

  return null;
}
