import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
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
      {/* Sidebar */}
      <Sidebar />

      {/* Main content area */}
      <div
        className={`flex flex-1 flex-col transition-all duration-300 ${
          sidebarOpen ? 'ml-64' : 'ml-16'
        }`}
      >
        <Header />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
