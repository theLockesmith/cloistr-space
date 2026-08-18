import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { SubHeader } from './SubHeader';
import { Header as UnifiedHeader, Footer } from '@cloistr/ui/components';
import { ToastContainer } from '@/components/common/Toast';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useContactsSync } from '@/services/crdt';
import { useAuth } from '@/components/auth/AuthProvider';

export function MainLayout() {
  const { sidebarOpen, mobileNavOpen, toggleMobileNav } = useWorkspaceStore();
  // space authenticates through its own local AuthProvider (zustand authStore),
  // not SharedAuthProvider. Pass that session to the shared Header so its Sign Out
  // clears the local store + shared session — otherwise logout is a no-op here.
  const { isAuthenticated, pubkey, logout } = useAuth();

  // Initialize contacts sync - auto-syncs on auth + connection
  useContactsSync({
    autoSync: true,
    subscribeToUpdates: true,
  });

  return (
    <div className="flex h-screen bg-cloistr-dark">
      {/* Skip navigation link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-cloistr-primary focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to main content
      </a>

      {/* Sidebar */}
      <Sidebar />

      {/* Main content area.
          The sidebar is off-canvas below md, so the content must NOT be pushed
          over by ml-64/ml-16 there — that margin is what left a phone with a
          sliver of usable width. min-w-0 so a wide child cannot set the floor
          and overflow the row horizontally. */}
      <div
        className={`flex min-w-0 flex-1 flex-col transition-all duration-300 ml-0 ${
          sidebarOpen ? 'md:ml-64' : 'md:ml-16'
        }`}
      >
        {/* Mobile-only control to reach the drawer, since it is off-canvas. */}
        <button
          type="button"
          // z ABOVE the header. At z-50 this tied with .cloistr-header and lost on
          // DOM order, so the only control that opens the drawer was painted over
          // and unreachable — the drawer existed but looked absent on a phone.
          className="absolute left-2 top-2 z-[var(--cloistr-z-drawer,70)] rounded-lg p-2 text-cloistr-light/70 hover:bg-cloistr-light/10 md:hidden"
          aria-label="Open navigation"
          aria-expanded={mobileNavOpen}
          onClick={toggleMobileNav}
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <UnifiedHeader
          activeServiceId="space"
          auth={{
            authenticated: isAuthenticated,
            pubkey: pubkey ?? undefined,
            onLogout: logout,
          }}
        />
        <SubHeader />
        <main id="main-content" className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
        <Footer />
      </div>

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  );
}
