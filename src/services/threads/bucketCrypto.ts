/**
 * @fileoverview Bucket computation for the blind-mailbox thread design.
 *
 * Every thread message is a kind 1059 gift-wrap carrying only a bucket tag.
 * The bucket is a hash prefix that deliberately collides across unrelated
 * threads, so the relay cannot tell which wrap belongs to which thread.
 *
 * FORMAT CONSTANTS (B, WINDOW_SECONDS, BUCKETS_PER_READER) are not
 * configuration. Changing any of them is a flag day: a reader on B=8 cannot
 * find a writer on B=10. See the design doc for the migration plan.
 */

import { sha256 } from '@noble/hashes/sha2.js';

/** B: number of hash prefix bits used for the bucket tag. 2^B = 256 buckets. */
export const BUCKET_BITS = 8;

/** Window duration in seconds. Buckets rotate every window. */
export const WINDOW_SECONDS = 86400; // 24 hours

/** K: every reader subscribes to exactly this many buckets per window. */
export const BUCKETS_PER_READER = 16;

/**
 * The epoch-day number for a Unix timestamp (seconds).
 * Defaults to now. Two timestamps in the same 24h UTC window return the same id.
 */
export function getWindowId(timestampSec?: number): number {
  const ts = timestampSec ?? Math.floor(Date.now() / 1000);
  return Math.floor(ts / WINDOW_SECONDS);
}

/** Encode a window id as 4 big-endian bytes. */
function windowBytes(windowId: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, windowId, false);
  return buf;
}

/**
 * Thread message bucket.
 *
 *     bucket = first B bits of SHA-256(thread_secret || window_id)
 *
 * @param threadSecret  The thread's 32-byte secret key
 * @param windowId      From getWindowId()
 * @returns 0..255 (when B=8)
 */
export function computeThreadBucket(
  threadSecret: Uint8Array,
  windowId: number,
): number {
  const wBytes = windowBytes(windowId);
  const input = new Uint8Array(threadSecret.length + wBytes.length);
  input.set(threadSecret);
  input.set(wBytes, threadSecret.length);
  return sha256(input)[0]; // first byte = first 8 bits
}

/**
 * Key-handoff bucket.
 *
 *     bucket = first B bits of SHA-256(ECDH_shared || "handoff" || window_id)
 *
 * The ECDH shared key is `nip44.v2.utils.getConversationKey(mySk, theirPk)`.
 * Both parties can compute it, nobody else can.
 *
 * @param ecdhShared  32-byte NIP-44 conversation key between granter and member
 * @param windowId    From getWindowId()
 */
export function computeHandoffBucket(
  ecdhShared: Uint8Array,
  windowId: number,
): number {
  const label = new TextEncoder().encode('handoff');
  const wBytes = windowBytes(windowId);
  const input = new Uint8Array(ecdhShared.length + label.length + wBytes.length);
  input.set(ecdhShared);
  input.set(label, ecdhShared.length);
  input.set(wBytes, ecdhShared.length + label.length);
  return sha256(input)[0];
}

/**
 * Build the K-element bucket set a reader subscribes to.
 *
 * Includes all real buckets plus random padding, shuffled so position
 * reveals nothing. Uses crypto-quality randomness for padding.
 *
 * @param realBuckets  Buckets the reader actually needs (thread + handoff)
 * @returns Exactly BUCKETS_PER_READER (16) bucket numbers, shuffled
 */
export function generateBucketSet(realBuckets: number[]): number[] {
  const maxBucket = 1 << BUCKET_BITS;
  const set = new Set(realBuckets);

  // Pad with crypto-random buckets
  while (set.size < BUCKETS_PER_READER) {
    const rand = globalThis.crypto.getRandomValues(new Uint8Array(1))[0];
    set.add(rand % maxBucket);
  }

  // Fisher-Yates shuffle with crypto randomness
  const arr = Array.from(set);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

/**
 * Bucket number to its 2-char hex tag value.
 */
export function bucketToTag(bucket: number): string {
  return bucket.toString(16).padStart(2, '0');
}

/**
 * Parse a bucket tag value back to a number.
 */
export function tagToBucket(tag: string): number {
  return parseInt(tag, 16);
}

/**
 * Generate a random timestamp within a window.
 *
 * NIP-59 randomises created_at by up to two days, but the bucket is derived
 * from the true window, so unbounded jitter would stop a reader from using
 * created_at to bound its search. The jitter stays inside the window.
 */
export function jitteredTimestamp(windowId: number): number {
  const windowStart = windowId * WINDOW_SECONDS;
  const offset = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % WINDOW_SECONDS;
  return windowStart + offset;
}
