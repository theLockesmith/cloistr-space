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
 * and the wrap's MAC did not match. A timeout, a refusal or any other failure is
 * not, because remembering it would hide a real hand-off until it expires.
 *
 * Kept per user pubkey, pruned when the wraps expire off the relays, and
 * cleared on sign-out.
 */

const PREFIX = 'cloistr:tried-wraps:';

/** For a wrap without an expiration tag: hand-offs live about two windows. */
const FALLBACK_TTL_SECONDS = 3 * 86400;

/**
 * True only when the signer tried the user's key and the wrap did not open.
 * The real signer answers "decryption failed: invalid hmac" (cloistr-signer
 * handleNIP44Decrypt, go-nostr nip44); a key held in the browser gives
 * nostr-tools' "invalid MAC".
 */
export function isNotAddressedToUs(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /invalid h?mac/i.test(message);
}

/** When a wrap leaves the relays: its expiration tag, else a safe default. */
export function wrapExpiry(event: { tags: string[][]; created_at?: number }): number {
  const tag = event.tags.find((t) => t[0] === 'expiration')?.[1];
  const exp = tag ? Number(tag) : NaN;
  if (Number.isFinite(exp) && exp > 0) return exp;
  return (event.created_at ?? Math.floor(Date.now() / 1000)) + FALLBACK_TTL_SECONDS;
}

function read(userPk: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(PREFIX + userPk);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function hasTriedWrap(userPk: string, wrapId: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const exp = read(userPk)[wrapId];
  return exp !== undefined && exp > nowSec;
}

export function recordTriedWrap(
  userPk: string,
  wrapId: string,
  expiresAt: number,
  nowSec = Math.floor(Date.now() / 1000),
): void {
  const kept: Record<string, number> = {};
  for (const [id, exp] of Object.entries(read(userPk))) {
    if (exp > nowSec) kept[id] = exp;
  }
  if (expiresAt > nowSec) kept[wrapId] = expiresAt;
  try {
    localStorage.setItem(PREFIX + userPk, JSON.stringify(kept));
  } catch {
    // Storage blocked or full: the wrap is simply tried again next load.
  }
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

/** On sign-out. */
export function clearTriedWraps(): void {
  removeWhere(() => true);
}
