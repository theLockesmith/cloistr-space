import { useAuth } from '@/components/auth/AuthProvider';
import { useLocation } from 'react-router-dom';

const viewTitles: Record<string, string> = {
  '/activity': 'Activity',
  '/projects': 'Projects',
  '/social': 'Social',
};

export function Header() {
  const { pubkey, logout } = useAuth();
  const location = useLocation();

  const title = viewTitles[location.pathname] ?? 'Cloistr Space';
  const shortPubkey = pubkey ? `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}` : '';

  return (
    <header className="flex h-16 items-center justify-between border-b border-cloistr-light/10 px-6">
      <h1 className="text-xl font-semibold text-cloistr-light">{title}</h1>

      <div className="flex items-center gap-4">
        {/* Notifications */}
        <button className="relative rounded-lg p-2 text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {/* Notification badge */}
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-cloistr-accent" />
        </button>

        {/* User menu */}
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-cloistr-primary/20" />
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-cloistr-light">{shortPubkey}</p>
          </div>
          <button
            onClick={logout}
            className="rounded-lg p-2 text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light"
            title="Logout"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
