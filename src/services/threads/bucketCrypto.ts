/**
 * Bucket computation for the blind-mailbox thread design.
 *
 * Wire format matches the kit's thread_wrap.py byte-for-byte:
 *   bucket = first byte of sha256(UTF-8(hex_secret + decimal_window))
 *   handoff_bucket = first byte of sha256(UTF-8(ecdh_hex + "handoff" + decimal_window))
 *   ecdh_hex = sha256(32-byte big-endian ECDH x-coordinate) as 64 hex
 *
 * FORMAT CONSTANTS (B, WINDOW_SECONDS, BUCKETS_PER_READER) are not
 * configuration. Changing any of them is a flag day.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import { secp256k1 } from '@noble/curves/secp256k1.js';

export const BUCKET_BITS = 8;
export const WINDOW_SECONDS = 86400;
export const BUCKETS_PER_READER = 16;

export function getWindowId(timestampSec?: number): number {
  const ts = timestampSec ?? Math.floor(Date.now() / 1000);
  return Math.floor(ts / WINDOW_SECONDS);
}

/**
 * Thread message bucket.
 * Kit equivalent: `bucket(thread_secret, window)` in thread_wrap.py
 */
export function computeThreadBucket(threadSecretHex: string, windowId: number): string {
  const input = new TextEncoder().encode(threadSecretHex + String(windowId));
  const h = sha256(input);
  return h[0].toString(16).padStart(2, '0');
}

/**
 * Raw ECDH shared secret as 64-char hex.
 * Kit equivalent: `_ecdh_hex(secret_key, public_key)` in thread_wrap.py
 *
 * sha256(32-byte big-endian x-coordinate of ECDH(sk, lift_x(pk)))
 */
export function ecdhHex(skBytes: Uint8Array, pkHex: string): string {
  const pkBytes = hexToBytes('02' + pkHex);
  const shared = secp256k1.getSharedSecret(skBytes, pkBytes, false);
  const xBytes = shared.slice(1, 33);
  return bytesToHex(sha256(xBytes));
}

/**
 * Key-handoff bucket.
 * Kit equivalent: `handoff_bucket(ecdh, window)` in thread_wrap.py
 */
export function computeHandoffBucket(ecdhHexStr: string, windowId: number): string {
  const input = new TextEncoder().encode(ecdhHexStr + 'handoff' + String(windowId));
  const h = sha256(input);
  return h[0].toString(16).padStart(2, '0');
}

/**
 * Build the K-element bucket set a reader subscribes to.
 * All values are 2-char lowercase hex strings.
 */
export function generateBucketSet(realBuckets: string[]): string[] {
  const set = new Set(realBuckets);
  while (set.size < BUCKETS_PER_READER) {
    const rand = globalThis.crypto.getRandomValues(new Uint8Array(1))[0];
    set.add(rand.toString(16).padStart(2, '0'));
  }
  const arr = Array.from(set);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Jittered timestamp: uniform between window start and the given timestamp.
 * Kit equivalent: `jitter_ts(real_ts)` in thread_wrap.py
 */
export function jitteredTimestamp(realTimestampSec?: number): number {
  const now = realTimestampSec ?? Math.floor(Date.now() / 1000);
  const windowId = getWindowId(now);
  const windowStart = windowId * WINDOW_SECONDS;
  const spread = now - windowStart;
  if (spread <= 0) return windowStart;
  return windowStart + (globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % spread);
}

/**
 * Expiry timestamp: 2 windows after the given window.
 * Kit equivalent: `expiry_ts(real_ts)` in thread_wrap.py
 */
export function expiryTimestamp(windowId: number): number {
  return (windowId + 2) * WINDOW_SECONDS;
}

export function bucketToTag(bucket: number): string {
  return bucket.toString(16).padStart(2, '0');
}

export function tagToBucket(tag: string): number {
  return parseInt(tag, 16);
}
