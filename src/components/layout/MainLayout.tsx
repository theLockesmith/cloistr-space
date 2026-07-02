import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { SubHeader } from './SubHeader';
import { Header as UnifiedHeader, Footer } from '@cloistr/ui/components';
import { ToastContainer } from '@/components/common/Toast';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useContactsSync } from '@/services/crdt';
import { useAuth } from '@/components/auth/AuthProvider';

export function MainLayout() {
  const { sidebarOpen } = useWorkspaceStore();
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

      {/* Main content area */}
      <div
        className={`flex flex-1 flex-col transition-all duration-300 ${
          sidebarOpen ? 'ml-64' : 'ml-16'
        }`}
      >
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
