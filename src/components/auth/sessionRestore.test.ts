/**
 * @fileoverview Guards against the loading-state lockout.
 *
 * Space hung on "Loading..." forever and never rendered anything. No error, no
 * login screen, no way out.
 *
 * CAUSE: restoreSession branched
 *
 *     if (auth.method === 'nip07')                        { ... }
 *     else if (auth.method === 'nip46' && auth.bunkerUrl) { ... }
 *
 * with NO else. A shared SSO session reporting method 'nip46' with no
 * bunkerUrl matched neither branch, so nothing resolved the loading state and
 * AuthGuard rendered its spinner indefinitely.
 *
 * The worst property of it: an eternal spinner is indistinguishable from a slow
 * network. The operator waited rather than reloading, because the app gave them
 * no reason to think waiting would not work.
 *
 * Source-level, because the failure is an async function returning without
 * calling a setter -- there is no rendered output to assert against, and
 * driving it would mean standing up a signer, a relay and a cookie jar to
 * observe a spinner that never stops.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'AuthProvider.tsx'), 'utf8');
const loginPage = readFileSync(join(__dirname, 'LoginPage.tsx'), 'utf8');

describe('session restore always resolves the UI', () => {
  it('wraps the restore in a finally that clears loading', () => {
    // THE structural guarantee. Every branch already tries to resolve the
    // loading state and one did not -- which is not fixable by adding one more
    // setLoading call, because the next branch somebody adds will forget too.
    expect(source).toMatch(/}\s*finally\s*\{[\s\S]{0,600}?setLoading\(false\)/);
  });

  it('has an else for a session it cannot restore from', () => {
    // Without this, an unrecognised or incomplete session falls through every
    // branch silently. The finally now catches that too, but a session we
    // cannot use should say so rather than merely stop spinning.
    expect(source).toMatch(/hasBunkerUrl: !!auth\.bunkerUrl/);
    expect(source).toMatch(/could not restore your previous session/i);
  });

  it('does NOT clear the shared session when restore fails', () => {
    // bunkerUrl is written into the shared session only by a SUCCESSFUL
    // connect, so its absence means bootstrap has not succeeded yet -- not
    // that the session is corrupt. The observed cause is the signer answering
    // 409 key_locked, which is transient.
    //
    // Clearing here would sign the user out of EVERY Cloistr app to "fix" a
    // server-side condition that resolves on its own. My first version of this
    // fix did exactly that.
    const restore = source.slice(
      source.indexOf('const restoreSession'),
      source.indexOf('restoreSession();')
    );

    expect(restore).not.toContain('clearSharedSession()');
  });

  it('surfaces the reason on the login screen', () => {
    // Landing on a login screen with no explanation is only marginally better
    // than the spinner: the user still cannot tell whether something broke, and
    // a silent redirect invites them to assume their account is gone.
    expect(loginPage).toMatch(/useAuth\(\)/);
    expect(loginPage).toMatch(/role="alert"/);
  });
});
