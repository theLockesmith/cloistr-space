/**
 * @fileoverview The user's "let relays verify who you are" setting, kept across reloads.
 *
 * RelayAuthPolicy holds the live value, but only in memory, and NdkService is
 * rebuilt on every page load. Without this a user who switched authentication
 * off had it silently switched back on by the next reload, while Profile kept
 * showing whatever the fresh policy said. For a privacy setting that is the
 * worst way to fail: it looks honoured and is not.
 *
 * Per device, not per key. It describes how this browser talks to relays, and
 * storing it in a signed event would publish the preference to every relay.
 */

const STORAGE_KEY = 'cloistr-space:relay-auth-enabled';

/** The saved setting. Defaults to on when nothing is saved or storage is unavailable. */
export function loadRelayAuthEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/**
 * Save the setting. Returns false when storage refused the write, so the caller
 * can tell the user it will not survive a reload instead of implying it will.
 */
export function saveRelayAuthEnabled(enabled: boolean): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    return true;
  } catch {
    return false;
  }
}
