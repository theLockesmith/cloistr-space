/**
 * auth-production.ts
 *
 * Fixture helper that seeds localStorage so the space app starts as
 * authenticated, bypassing the NIP-46 browser flow.
 *
 * WHY SEEDING INSTEAD OF BROWSER LOGIN
 * The space app's login path goes through connectNip46(), which opens a
 * WebSocket to relay.cloistr.xyz and waits for the signer to respond.
 * That path has broken twice (once from a setLoading(false) never called,
 * once from a null bunkerUrl in the shared session). Seeding lets the
 * content-level assertions run independently of that path.
 *
 * The login path itself is exercised by the dedicated test in
 * authenticated.spec.ts under "Login flow".
 *
 * HOW IT WORKS
 * The Zustand authStore is persisted under 'cloistr-space-auth'.
 * The NIP-46 session (bunkerUrl + clientSecretKey) is stored separately
 * under 'cloistr-space-session'. Both are seeded via addInitScript before
 * the page loads, so the store rehydrates already-authenticated and
 * restoreSession() has the material it needs for the NIP-46 reconnect.
 *
 * The reconnect to the production signer may or may not succeed in a given
 * test run (key may be locked on a different replica). If it fails,
 * SignerErrorOverlay appears after the 15 s NIP-46 session restore timeout.
 * dismissSignerError() handles that by waiting up to 20 s for the "Go back"
 * button — long enough to catch the 15 s NIP-46 timeout — and clicking it
 * so read-only tests can proceed without signing capability.
 */

import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SESSION_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.auth/session.json');

export interface SessionFixture {
  bunkerUrl: string;
  clientSecretKey: string;
  pubkey: string;
}

export function loadSessionFixture(): SessionFixture {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as SessionFixture;
  } catch {
    throw new Error(
      `Auth fixture not found at ${SESSION_FILE}. ` +
      `Run global-setup first: npx playwright test --project=authenticated-production --list`,
    );
  }
}

/**
 * Seed the space app's auth state into localStorage before the page loads.
 * Must be called before page.goto().
 */
export async function seedAuthState(page: Page, session: SessionFixture): Promise<void> {
  await page.addInitScript(
    ({ bunkerUrl, clientSecretKey, pubkey }) => {
      // cloistr-space-session — what AuthProvider.restoreSession() reads
      localStorage.setItem(
        'cloistr-space-session',
        JSON.stringify({ method: 'nip46', bunkerUrl, clientSecretKey }),
      );

      // cloistr-space-auth — Zustand persist state
      // isLoading: false so AuthGuard does not block on the NIP-46 reconnect
      localStorage.setItem(
        'cloistr-space-auth',
        JSON.stringify({
          state: {
            pubkey,
            method:          'nip46',
            isAuthenticated: true,
            isLoading:       false,
            signerUrl:       'https://signer.cloistr.xyz',
            lastActivity:    Date.now(),
            sessionExpiresAt: Date.now() + 30 * 60 * 1000,
          },
          version: 0,
        }),
      );

      // Shared session cookies — used by @cloistr/ui's SharedAuthProvider
      const cookieOpts = 'domain=.cloistr.xyz; path=/; max-age=86400; secure; samesite=lax';
      document.cookie = `cloistr_auth_method=nip46; ${cookieOpts}`;
      document.cookie = `cloistr_auth_pubkey=${pubkey}; ${cookieOpts}`;
      document.cookie = `cloistr_auth_bunker=${encodeURIComponent(bunkerUrl)}; ${cookieOpts}`;
    },
    { bunkerUrl: session.bunkerUrl, clientSecretKey: session.clientSecretKey, pubkey: session.pubkey },
  );
}

/**
 * If the NIP-46 reconnect failed, SignerErrorOverlay is visible.
 * Dismiss it so read-only tests can proceed — the session remains valid
 * and content still loads from relays.
 *
 * TIMING: AuthProvider.restoreSession() races a 15 s timeout against the
 * NIP-46 handshake. If the signer is on a different replica or the relay is
 * slow, the overlay appears at ~15 s after page load. We wait 20 s so we
 * catch that scenario. Callers must budget for this wait.
 */
export async function dismissSignerError(page: Page): Promise<void> {
  // SignerRecovery (@cloistr/ui) renders a "Go back" button.
  // It may not appear if the reconnect succeeded or has not yet timed out.
  const goBack = page.getByRole('button', { name: /go back/i });
  try {
    await goBack.waitFor({ state: 'visible', timeout: 20000 });
    await goBack.click();
    await goBack.waitFor({ state: 'hidden', timeout: 3000 });
  } catch {
    // Overlay did not appear — reconnect succeeded or was not needed.
  }
}
