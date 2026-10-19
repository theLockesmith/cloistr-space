/**
 * @fileoverview The user's "let relays verify who you are" setting, per user, kept across reloads.
 *
 * RelayAuthPolicy holds the live value, but only in memory, and NdkService is
 * rebuilt on every page load. Without saving it, a user who switched
 * authentication off had it silently switched back on by the next reload, while
 * Profile kept showing whatever the fresh policy said. For a privacy setting
 * that is the worst way to fail: it looks honoured and is not.
 *
 * Scoped to the pubkey. NdkService is built once, before anyone signs in, and
 * outlives account switches, so an unscoped value would hand account A's "off"
 * to account B on a shared browser and show B what A chose. NdkProvider applies
 * the signed-in user's value to the live policy whenever the pubkey changes.
 *
 * Kept in localStorage, not a signed event: a signed event would publish the
 * preference to every relay.
 *
 * Writes also land in an in-memory copy, which reads consult first. If the
 * browser refuses the write, the choice still holds for the rest of the
 * session, and every reader sees the same value.
 */

import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_PREFIX = 'cloistr-space:relay-auth-enabled:';

/** On for anyone with no saved choice, and when nobody is signed in. */
const DEFAULT_ENABLED = true;

const session = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** The saved setting for this user, or the default. */
export function loadRelayAuthEnabled(pubkey: string | null): boolean {
  if (!pubkey) return DEFAULT_ENABLED;
  const inSession = session.get(pubkey);
  if (inSession !== undefined) return inSession;
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + pubkey);
    return stored === null ? DEFAULT_ENABLED : stored !== 'false';
  } catch {
    return DEFAULT_ENABLED;
  }
}

/**
 * Save the setting for this user. Returns false when it will not survive a
 * reload -- storage refused the write, or there is no user to save it for -- so
 * the caller can say so instead of implying it will.
 */
export function saveRelayAuthEnabled(pubkey: string | null, enabled: boolean): boolean {
  if (!pubkey) return false;
  session.set(pubkey, enabled);
  listeners.forEach((listener) => listener());
  try {
    localStorage.setItem(STORAGE_PREFIX + pubkey, String(enabled));
    return true;
  } catch {
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The setting for this user, re-rendering when it is saved. */
export function useRelayAuthEnabled(pubkey: string | null): boolean {
  const read = useCallback(() => loadRelayAuthEnabled(pubkey), [pubkey]);
  return useSyncExternalStore(subscribe, read);
}

/** Test seam: forget in-session values, as a reload does. */
export function resetRelayAuthSessionForTests(): void {
  session.clear();
}
