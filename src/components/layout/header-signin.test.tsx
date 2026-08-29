import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { Header } from '@cloistr/ui/components';
import { AuthProvider } from '@cloistr/auth';
import { MemoryRouter } from 'react-router-dom';

/**
 * Operator, on space.cloistr.xyz while signed out: the Sign In button is on the
 * page body but missing from the header, where they expected it.
 *
 * Cause is in the SHARED Header, but it is not a shared-component bug. Passing
 * an `auth` prop at all tells the Header this app manages its own session, and
 * its signed-out branch then renders null specifically when `onSignIn` is
 * absent. That case is deliberate and correct -- it exists for login screens,
 * where the page IS the form and a second Sign In control would be redundant.
 *
 * MainLayout wraps EVERY route, not just the login screen, so Space took the
 * login-screen branch everywhere and lost its only header affordance for
 * signing in. @cloistr/ui already supports onSignIn; Space simply never passed
 * it.
 *
 * These render the real Header rather than a fixture: a hand-rolled stub would
 * pass without proving anything about the component whose branch is at issue.
 */

afterEach(cleanup);

function renderHeader(auth: Parameters<typeof Header>[0]['auth']) {
  // Header calls useNostrAuth unconditionally (Header.tsx:67) even when an
  // external `auth` prop is supplied, so the provider is required to render it
  // at all. It does not drive these assertions -- `auth` overrides it.
  return render(
    <AuthProvider>
      <MemoryRouter>
        <Header activeServiceId="space" auth={auth} />
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('signed-out header sign-in affordance', () => {
  it('renders a Sign In control when signed out and onSignIn is supplied', () => {
    // The shipped MainLayout shape.
    renderHeader({ authenticated: false, onSignIn: vi.fn() });

    expect(
      screen.queryByRole('button', { name: /sign in/i }),
      'signed-out header renders no Sign In control despite onSignIn being passed'
    ).not.toBeNull();
  });

  it('calls onSignIn when that control is clicked', () => {
    const onSignIn = vi.fn();
    renderHeader({ authenticated: false, onSignIn });

    screen.getByRole('button', { name: /sign in/i }).click();

    // MainLayout routes this to /login. A rendered-but-inert button would look
    // identical to the operator until they clicked it.
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('renders NO Sign In control when onSignIn is omitted', () => {
    // Pins the regression itself. This is the exact shape MainLayout shipped,
    // and it is also the shape a login screen legitimately wants -- so the
    // behaviour must stay available rather than be "fixed" in @cloistr/ui.
    renderHeader({ authenticated: false });

    expect(
      screen.queryByRole('button', { name: /sign in/i }),
      'omitting onSignIn should suppress the control; if this now renders, the ' +
        'shared login-screen branch changed and Space is no longer the whole fix'
    ).toBeNull();
  });
});
