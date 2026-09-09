/**
 * @fileoverview Per-thread secret key management for sealed (NIP-44 encrypted) threads.
 *
 * Each sealed thread has its own Nostr keypair. The thread's SECRET key lets any
 * holder decrypt every message in the thread: message content is encrypted as
 * `nip44.encrypt(plaintext, conversationKey(thread_sk, author_pk))` and the
 * recipient reverses it with `nip44.decrypt(payload, conversationKey(thread_sk, author_pk))`.
 *
 * Thread keys are distributed via key-wrap events: a small NIP-44 encrypted
 * event containing the thread's secret key, wrapped to each member's pubkey.
 * On load this store fetches wraps tagged to the current user, asks the signer
 * to NIP-44-decrypt them, and caches the resulting keys in memory.
 *
 * No secret key ever touches persistent storage in the browser. The store is
 * emptied on logout/disconnect.
 */

import { nip44, utils as ntUtils } from 'nostr-tools';

const { bytesToHex, hexToBytes } = ntUtils;

/**
 * Kind used for thread key-wrap events. The fleet bridge publishes these as
 * addressable events (`d` tag = thread pubkey) so a wrap can be replaced on
 * key rotation without leaving the old one readable.
 *
 * Addressable replacement semantics: a newer event with the same `(pubkey, kind, d)`
 * fully replaces the older one, so a rotation publishes a new wrap and the relay
 * garbage-collects the old.
 */
export const KEY_WRAP_KIND = 24_242;

export interface ThreadKey {
  /** Thread's public key (hex). Also serves as the thread identifier. */
  threadPubkey: string;
  /** Thread's secret key (32 bytes). */
  secretKey: Uint8Array;
}

/**
 * Derive the NIP-44 conversation key for a (thread, author) pair.
 *
 * This is the symmetric key that actually encrypts/decrypts message content.
 * It is deterministic: same thread key + same author pubkey always yields the
 * same conversation key, so it can be cached.
 */
export function getThreadConversationKey(
  threadSecretKey: Uint8Array,
  authorPubkey: string
): Uint8Array {
  return nip44.v2.utils.getConversationKey(threadSecretKey, authorPubkey);
}

/**
 * Decrypt a sealed thread message.
 *
 * @param ciphertext  NIP-44 v2 payload (base64 string from the event's `content` field)
 * @param threadSecretKey  The thread's 32-byte secret key
 * @param authorPubkey  The message author's public key (hex)
 * @returns The plaintext content, or null if decryption fails
 */
export function decryptThreadContent(
  ciphertext: string,
  threadSecretKey: Uint8Array,
  authorPubkey: string
): string | null {
  try {
    const ck = getThreadConversationKey(threadSecretKey, authorPubkey);
    return nip44.v2.decrypt(ciphertext, ck);
  } catch {
    return null;
  }
}

/**
 * Encrypt content for a sealed thread.
 *
 * @param plaintext  The message body
 * @param threadSecretKey  The thread's 32-byte secret key
 * @param authorPubkey  The author's public key (hex) -- typically the current user
 * @returns NIP-44 v2 ciphertext
 */
export function encryptThreadContent(
  plaintext: string,
  threadSecretKey: Uint8Array,
  authorPubkey: string
): string {
  const ck = getThreadConversationKey(threadSecretKey, authorPubkey);
  return nip44.v2.encrypt(plaintext, ck);
}

/**
 * In-memory store for thread secret keys.
 *
 * Keyed by the thread's public key (hex). Emptied on clear() -- callers should
 * call clear() on logout so keys do not survive a session switch.
 */
export class ThreadKeyStore {
  private keys = new Map<string, Uint8Array>();

  /** Register a thread key. Overwrites any existing key for the same thread. */
  set(threadPubkey: string, secretKey: Uint8Array): void {
    this.keys.set(threadPubkey, secretKey);
  }

  /** Look up a thread's secret key. Returns undefined when the key is not held. */
  get(threadPubkey: string): Uint8Array | undefined {
    return this.keys.get(threadPubkey);
  }

  /** True when a key is held for this thread. */
  has(threadPubkey: string): boolean {
    return this.keys.has(threadPubkey);
  }

  /** Remove all stored keys. Call on logout / disconnect. */
  clear(): void {
    this.keys.clear();
  }

  /** Number of thread keys currently held. */
  get size(): number {
    return this.keys.size;
  }

  /**
   * Import a thread key from a hex-encoded secret key string.
   * This is the format carried inside key-wrap event content after NIP-44
   * decryption of the wrap.
   */
  importHex(threadPubkey: string, secretKeyHex: string): void {
    this.keys.set(threadPubkey, hexToBytes(secretKeyHex));
  }

  /**
   * Export a thread key as hex. For diagnostics only -- avoid serialising
   * secrets when possible.
   */
  exportHex(threadPubkey: string): string | undefined {
    const sk = this.keys.get(threadPubkey);
    return sk ? bytesToHex(sk) : undefined;
  }
}

/**
 * Detect whether a string looks like a NIP-44 v2 payload.
 *
 * NIP-44 v2 payloads are base64-encoded and start with a version byte of 0x02.
 * After base64 decoding, the first byte is 0x02. In base64, a leading 0x02
 * byte produces a string starting with 'A' (since 0x02 in the first 6-bit
 * group is 0b000000, second group starts with 0b10...).
 *
 * A more reliable check: try to base64-decode and check the version byte.
 * But for a quick filter before attempting decryption, checking that the string
 * is NOT valid NIP-04 (which contains `?iv=`) and IS base64-ish is sufficient.
 */
export function looksLikeNip44(content: string): boolean {
  // NIP-04 payloads contain "?iv=" -- NIP-44 never does
  if (content.includes('?iv=')) return false;
  // Empty or very short strings are not NIP-44
  if (content.length < 32) return false;
  // NIP-44 v2 is base64-encoded. A rough check: only base64 characters.
  return /^[A-Za-z0-9+/]+=*$/.test(content);
}
