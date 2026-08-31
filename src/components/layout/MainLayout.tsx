import { Outlet, useNavigate } from 'react-router-dom';
import { AppShell, AppShellToggle } from '@cloistr/ui/components';
import { Header as UnifiedHeader, Footer } from '@cloistr/ui/components';
import { SpaceNavLinks } from './SpaceNavLinks';
import { NotificationBadge } from './NotificationBadge';
import { ToastContainer } from '@/components/common/Toast';
import { useContactsSync } from '@/services/crdt';
import { useRelayPrefsSync } from '@/services/nostr';
import { useAuth } from '@/components/auth/AuthProvider';

/**
 * MainLayout — outer shell for all authenticated routes.
 *
 * AppShell owns the single mobile hamburger (opens a drawer with SpaceNavLinks)
 * and renders the nav links as a sidebar on desktop. No app-owned hamburger
 * lives here — that was the source of the double-hamburger measured in the
 * 2026-08-24 audit.
 *
 * Space has in-app nav (Activity, Projects, Social) but no app-level menu
 * commands. AppShell receives `nav` only; it renders no menu bar and no
 * hamburger on desktop, and exactly one hamburger on mobile.
 */
export function MainLayout() {
  // space authenticates through its own local AuthProvider (zustand authStore),
  // not SharedAuthProvider. Pass that session to the shared Header so its Sign Out
  // clears the local store + shared session — otherwise logout is a no-op here.
  const { isAuthenticated, pubkey, logout } = useAuth();
  const navigate = useNavigate();

  // Resolve the user's own relays (kind:30078 cloistr-relays, falling back to
  // NIP-65 kind:10002) and hand them to NDK. Without this the pool stays on the
  // hardcoded default and the relay list a user curates on the Profile page is
  // never read back.
  useRelayPrefsSync();

  // Initialize contacts sync — auto-syncs on auth + connection.
  useContactsSync({
    autoSync: true,
    subscribeToUpdates: true,
  });

  return (
    <>
      {/* Skip navigation link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-cloistr-primary focus:px-4 focus:py-2 focus:text-cloistr-primary-fg"
      >
        Skip to main content
      </a>

      {/*
        AppShell owns the single mobile hamburger.
        nav=... → hamburger on mobile (opens drawer with SpaceNavLinks),
                   sidebar in flow on desktop (no hamburger, no drawer).
        No menu prop → no horizontal menu bar, no menu sections in the drawer.
        Neither condition → no hamburger at all (per navigation-model.md).
      */}
      {/* toggleInHeader: without it AppShell renders the control as its own
          row ABOVE the content, which showed up as unexplained blank space
          above the header. Portaled into UnifiedHeader instead. */}
      <AppShell serviceId="space" nav={<SpaceNavLinks />} toggleInHeader>
        <AppShellToggle />
        {/* h-dvh here so the inner flex column fills the AppShell content area. */}
        <div className="flex h-dvh flex-col bg-cloistr-dark">
          <UnifiedHeader
            activeServiceId="space"
            auth={{
              authenticated: isAuthenticated,
              pubkey: pubkey ?? undefined,
              onLogout: logout,
              // Without this the header renders NO sign-in control when logged
              // out. Passing `auth` at all makes the shared Header treat this
              // app as managing its own session, and its logged-out branch then
              // renders null specifically when onSignIn is absent -- that case
              // exists for login screens, where the page IS the form and a
              // second Sign In button would be redundant. MainLayout wraps every
              // route, not just the login screen, so it was taking the
              // login-screen branch everywhere and the header lost its only
              // affordance for signing in.
              onSignIn: () => navigate('/login'),
            }}
          >
            {/* @cloistr/ui's Header renders `children` in its right-hand
                cluster, so this is a Space-local element in a slot the shared
                component already provides -- no change to @cloistr/ui. */}
            <NotificationBadge />
          </UnifiedHeader>
          <main id="main-content" className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
          <Footer />
        </div>
      </AppShell>

      {/* Toast notifications — rendered outside AppShell so they overlay everything. */}
      <ToastContainer />
    </>
  );
}
