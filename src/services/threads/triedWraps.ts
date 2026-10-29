/**
 * Hand-off wraps the signer has already said are not for this user.
 *
 * Hand-off buckets are one byte, so the bucket a user reads also carries other
 * people's hand-offs from the same granter. A signer (NIP-46) user can only
 * find out which are theirs by asking the signer to open each one, a round trip
 * apiece, and the answer never changes. Without remembering it, the Threads
 * page asked again on every load: 18 of its 20 signer requests on the test
 * account (live, 2026-10-28), many more for a user with several granters.
 *
 * Only a definite "not yours" is remembered: the signer tried this user's key
 * and the wrap's MAC did not match, AND the wrap's signature verifies. A
 * timeout or refusal is not remembered, or a real hand-off would be lost until
 * it expires. Nor is an unverified wrap: a damaged copy of the user's OWN
 * hand-off, sent under the real one's id, also fails the MAC, and remembering
 * it would skip the real one.
 *
 * The list is stored like the thread keys: NIP-44 encrypted to the user's own
 * key through the signer. In plain storage it would tell anyone who can read
 * this browser's storage, by elimination, which wraps in the user's bucket are
 * theirs. That costs one signer round trip per load to read it, against one per
 * wrap without it.
 *
 * Kept per user pubkey, pruned when the wraps expire off the relays, and
 * cleared on sign-out. A save still pending at sign-out or an account switch
 * is dropped.
 */
import type { Event } from 'nostr-tools';
import { verifyFresh } from '@/services/nostr/verifyFresh';

const PREFIX = 'cloistr:tried-wraps:';

/** For a wrap without an expiration tag: hand-offs live about two windows. */
const FALLBACK_TTL_SECONDS = 3 * 86400;

/** Records arriving together are written in one signer round trip. */
const PERSIST_DELAY_MS = 200;

/**
 * True only when the signer tried the user's key and the wrap did not open.
 * The real signer's error ends "decryption failed: invalid hmac"
 * (cloistr-signer handleNIP44Decrypt, go-nostr nip44, wrapped by
 * @cloistr/auth); a key held in the browser gives nostr-tools' "invalid MAC".
 */
export function isNotAddressedToUs(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /(?:^|decryption failed: )invalid h?mac$/i.test(message);
}

/**
 * The wrap is exactly what its signer published. Checked fresh: NDK only
 * spot-checks signatures from relays it trusts, and a verdict cached on a
 * copied object would pass a forged one.
 */
export function wrapVerifies(event: Event): boolean {
  try {
    return verifyFresh(event);
  } catch {
    return false;
  }
}

/** When a wrap leaves the relays: its expiration tag, else a safe default. */
export function wrapExpiry(event: { tags: string[][]; created_at?: number }): number {
  const tag = event.tags.find((t) => t[0] === 'expiration')?.[1];
  const exp = tag ? Number(tag) : NaN;
  if (Number.isFinite(exp) && exp > 0) return exp;
  return (event.created_at ?? Math.floor(Date.now() / 1000)) + FALLBACK_TTL_SECONDS;
}

export interface SelfCrypt {
  encrypt: (pubkey: string, plaintext: string) => Promise<string>;
  decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
}

export interface TriedWraps {
  has(wrapId: string): boolean;
  record(wrapId: string, expiresAt: number): void;
  /** Resolves once everything recorded so far is stored. */
  flush(): Promise<void>;
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Bumped by sign-out. A list opened before the bump never writes again: its
 * save is up to PERSIST_DELAY_MS behind, plus a signer round trip, and
 * landing after the clear would put the signed-out user's list back.
 */
let signOuts = 0;

/**
 * Read the user's list (one signer decrypt when one is stored). A list that
 * cannot be read starts empty: the wraps are simply asked about again.
 */
export async function openTriedWraps(
  userPk: string,
  crypt: SelfCrypt,
  now: () => number,
  /**
   * Whether `userPk` is still the one signed in. Checked before writing: an
   * account switch clears nothing, so a save started for the previous account
   * would otherwise land after the switch.
   */
  isCurrentUser: () => boolean,
): Promise<TriedWraps> {
  const openedAt = signOuts;
  const tried = new Map<string, number>();
  try {
    const blob = localStorage.getItem(PREFIX + userPk);
    if (blob) {
      const stored = JSON.parse(await crypt.decrypt(userPk, blob)) as Record<string, number>;
      for (const [id, exp] of Object.entries(stored)) {
        if (typeof exp === 'number' && exp > now()) tried.set(id, exp);
      }
    }
  } catch {
    // Unreadable or storage blocked: start empty.
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();

  const persist = () => {
    timer = null;
    if (signOuts !== openedAt || !isCurrentUser()) return;
    const t = now();
    for (const [id, exp] of tried) if (exp <= t) tried.delete(id);
    const snapshot = JSON.stringify(Object.fromEntries(tried));
    writing = writing.then(async () => {
      try {
        const blob = await crypt.encrypt(userPk, snapshot);
        if (signOuts === openedAt && isCurrentUser()) localStorage.setItem(PREFIX + userPk, blob);
      } catch {
        // Signer or storage unavailable: asked again next load.
      }
    });
  };

  return {
    has: (wrapId) => {
      const exp = tried.get(wrapId);
      return exp !== undefined && exp > now();
    },
    record: (wrapId, expiresAt) => {
      if (expiresAt <= now()) return;
      tried.set(wrapId, expiresAt);
      if (!timer) timer = setTimeout(persist, PERSIST_DELAY_MS);
    },
    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        persist();
      }
      await writing;
    },
  };
}

function removeWhere(drop: (userPk: string) => boolean): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) && drop(k.slice(PREFIX.length))) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // Storage unavailable: nothing was kept to clear.
  }
}

/** On account switch: only the signed-in user's list stays. */
export function forgetOtherUsers(userPk: string): void {
  removeWhere((pk) => pk !== userPk);
}

/** On sign-out. Lists already open stop writing. */
export function clearTriedWraps(): void {
  signOuts += 1;
  removeWhere(() => true);
}
