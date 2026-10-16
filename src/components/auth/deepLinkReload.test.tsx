/**
 * @fileoverview A signed-in reload of a deep link must land on that page.
 *
 * Live defect G1 (#325 bug 2): reloading /social, /threads, /profile, /projects
 * or /notifications while signed in ended on /activity.
 *
 * CAUSE, in two halves:
 *
 *  1. Every sign-in goes through the shared LoginModal, so Space's own session
 *     record is never written and a reload depends on the SHARED provider
 *     reconnecting the remote signer. That provider stops holding the page as
 *     soon as a backend login token exists, so Space mounts while the signer
 *     is still reconnecting. Space's own restore found only the shared cookie
 *     (no client key), gave up, and reported "signed out". AuthGuard then
 *     redirected to /login.
 *  2. LoginPage always forwarded a signed-in user to /activity, so when the
 *     shared session landed a moment later, the page the user asked for was
 *     already gone.
 *
 * Driven through the real AuthProvider, AuthGuard and LoginPage; only the
 * shared provider's state is faked, because that state is the input here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet, Navigate, useLocation } from 'react-router-dom';

const h = vi.hoisted(() => ({
  shared: {
    authState: {
      isConnected: false,
      isConnecting: false,
      pubkey: null as string | null,
      activePubkey: null as string | null,
      method: null as string | null,
      isSwitching: false,
    },
    signer: null as unknown,
  },
  session: {
    isResolving: false,
    hasSharedSession: false,
  },
  cookie: null as null | { method: string; pubkey: string; bunkerUrl?: string },
}));

vi.mock('@cloistr/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cloistr/auth')>();
  return { ...actual, useNostrAuth: () => h.shared };
});

vi.mock('@cloistr/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cloistr/ui')>();
  return {
    ...actual,
    getSharedSession: () => h.cookie,
    saveSharedSession: vi.fn(),
    clearSharedSession: vi.fn(),
  };
});

vi.mock('@cloistr/ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cloistr/ui/components')>();
  return {
    ...actual,
    useSharedSessionMaybe: () => ({ ...h.session }),
    LoginModal: () => null,
    Header: () => null,
  };
});

import { AuthProvider } from './AuthProvider';
import { AuthGuard } from './AuthGuard';
import { LoginPage } from './LoginPage';
import { useAuthStore } from '@/stores/authStore';

const PUBKEY = 'a'.repeat(64);

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function tree(entry: string) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Where />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <AuthGuard>
                <Outlet />
              </AuthGuard>
            }
          >
            <Route path="activity" element={<div>activity page</div>} />
            <Route path="social" element={<div>social page</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

const where = () => screen.getByTestId('where').textContent;

async function settle() {
  // Let restoreSession's effect, the bridge's queued microtask and the
  // resulting store updates all run.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function sharedConnects() {
  h.shared.authState = {
    ...h.shared.authState,
    isConnected: true,
    isConnecting: false,
    pubkey: PUBKEY,
    activePubkey: PUBKEY,
    method: 'nip46',
  };
  h.shared.signer = { getPublicKey: async () => PUBKEY };
  h.session.isResolving = false;
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ pubkey: null, method: null, isAuthenticated: false, isLoading: true });
  h.shared.authState = {
    isConnected: false,
    isConnecting: false,
    pubkey: null,
    activePubkey: null,
    method: null,
    isSwitching: false,
  };
  h.shared.signer = null;
  h.session.isResolving = false;
  h.session.hasSharedSession = false;
  h.cookie = null;
});

afterEach(cleanup);

describe('signed-in reload of a deep link', () => {
  it('waits for the shared restore instead of redirecting, then stays on the page', async () => {
    // A returning user: the shared cookie exists and the shared provider is
    // still reconnecting the signer when Space mounts.
    h.cookie = { method: 'nip46', pubkey: PUBKEY, bunkerUrl: 'bunker://x?relay=wss://r' };
    h.session.hasSharedSession = true;
    h.session.isResolving = true;

    const { rerender } = render(tree('/social'));
    await settle();

    // Space's own restore has finished and found nothing usable. It must not
    // read that as "signed out" while the shared restore is still running.
    expect(where()).toBe('/social');
    expect(screen.queryByText('social page')).toBeNull();

    sharedConnects();
    rerender(tree('/social'));
    await settle();

    expect(where()).toBe('/social');
    expect(screen.getByText('social page')).toBeTruthy();
  });

  it('waits while a known session is still connecting after the restore gate lifts', async () => {
    h.cookie = { method: 'nip46', pubkey: PUBKEY, bunkerUrl: 'bunker://x?relay=wss://r' };
    h.session.hasSharedSession = true;
    h.shared.authState = { ...h.shared.authState, isConnecting: true };

    const { rerender } = render(tree('/social'));
    await settle();
    expect(where()).toBe('/social');

    sharedConnects();
    rerender(tree('/social'));
    await settle();
    expect(screen.getByText('social page')).toBeTruthy();
  });

  it('returns to the requested page after signing in, not to /activity', async () => {
    // Even when the user really is sent to /login, the page they asked for
    // must survive the round trip.
    const { rerender } = render(tree('/social?tab=wot'));
    await settle();
    expect(where()).toBe('/login');

    sharedConnects();
    rerender(tree('/social?tab=wot'));
    await settle();

    expect(where()).toBe('/social?tab=wot');
  });

  it('still sends a signed-in visitor to /login straight to /activity', async () => {
    const { rerender } = render(tree('/login'));
    await settle();
    expect(where()).toBe('/login');

    sharedConnects();
    rerender(tree('/login'));
    await settle();
    expect(where()).toBe('/activity');
  });

  it('never follows a return path that leaves the site', async () => {
    // '//host' is protocol-relative: a browser treats it as another origin.
    function Bounce() {
      return <Navigate to="/login" replace state={{ from: { pathname: '//evil.example/x' } }} />;
    }
    // A fresh element each render: re-rendering the same object is skipped.
    const app = () => (
      <MemoryRouter initialEntries={['/bounce']}>
        <AuthProvider>
          <Where />
          <Routes>
            <Route path="/bounce" element={<Bounce />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/activity" element={<div>activity page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
    const { rerender } = render(app());
    await settle();
    expect(where()).toBe('/login');

    sharedConnects();
    rerender(app());
    await settle();
    expect(where()).toBe('/activity');
  });

  it('shows the login page, not a spinner, when there is no session to restore', async () => {
    // The wait must be bounded by the shared provider settling: with nothing
    // restoring, a signed-out user reaches the login page.
    render(tree('/social'));
    await settle();

    expect(where()).toBe('/login');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not cover a first sign-in with the loading overlay', async () => {
    // A first login runs under isConnecting too, with the person interacting
    // with the modal. No shared session yet, so this must not count as a
    // restore in progress.
    h.shared.authState = { ...h.shared.authState, isConnecting: true };

    render(tree('/login'));
    await settle();

    expect(where()).toBe('/login');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
