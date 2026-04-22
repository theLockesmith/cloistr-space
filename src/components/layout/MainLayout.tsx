import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ToastContainer } from '@/components/common/Toast';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useContactsSync } from '@/services/crdt';

export function MainLayout() {
  const { sidebarOpen } = useWorkspaceStore();

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
        <Header />
        <main id="main-content" className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  );
}
