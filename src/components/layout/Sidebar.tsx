import { NavLink } from 'react-router-dom';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { RelayStatusCompact, RelayStatusDot } from './RelayStatus';

const navItems = [
  {
    path: '/activity',
    label: 'Activity',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    path: '/projects',
    label: 'Projects',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    path: '/social',
    label: 'Social',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const { sidebarOpen, toggleSidebar, mobileNavOpen, setMobileNavOpen } = useWorkspaceStore();
  const services = useWorkspaceStore((s) => s.services);

  // Map a probed service to an indicator state.
  //
  // 'pending' is reserved for "we have not probed this yet" — a service with no
  // lastPing. Once NdkProvider's poll has actually reported, the answer is
  // connected or disconnected, never pending. Previously every entry was
  // hardcoded 'pending', so a healthy service and an unprobed one were
  // indistinguishable and both read "Not wired".
  const statusOf = (key: string): 'connected' | 'disconnected' | 'pending' => {
    const svc = services.get(key);
    if (!svc || !svc.lastPing) return 'pending';
    return svc.isConnected ? 'connected' : 'disconnected';
  };

  return (
    <>
      {/* Backdrop: mobile only, only while the drawer is open. Tap to close. */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-[var(--cloistr-z-drawer-backdrop,60)] bg-black/50 md:hidden"
          aria-hidden="true"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/*
        TWO INDEPENDENT STATES, deliberately (governance §5.8).

        `sidebarOpen`    desktop rail: expanded w-64 vs collapsed w-16, always visible at md+
        `mobileNavOpen`  phone drawer: on screen vs fully off-canvas, closed by default

        An earlier version drove both from `sidebarOpen` alone and only slid the
        drawer away when it was FALSE. Since the store defaults it to true — the
        right default for a desktop rail — a phone rendered the full 256px panel
        over a 375px viewport. The authenticated audit measured exactly that: 68%
        of the screen. One boolean cannot carry both meanings, because their
        correct defaults are opposites.
      */}
      <aside
        className={[
          'fixed left-0 top-0 z-[var(--cloistr-z-drawer,70)] h-screen border-r border-cloistr-light/10 bg-cloistr-dark',
          'transition-transform duration-300',
          // Phone: full-width drawer regardless of the desktop rail state.
          // Desktop: the rail width follows sidebarOpen.
          'w-64',
          sidebarOpen ? 'md:w-64' : 'md:w-16',
          // Off-canvas below md unless opened; never translated at md+.
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
        ].join(' ')}
        aria-label="Workspace navigation"
      >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between border-b border-cloistr-light/10 px-4">
        {sidebarOpen && (
          <span className="text-lg font-bold text-cloistr-primary">Cloistr</span>
        )}
        <button
          onClick={toggleSidebar}
          className="rounded-lg p-2 text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Navigation */}
      <nav className="mt-4 space-y-1 px-2">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            // Dismiss the drawer on navigate — otherwise a phone tap changes the
            // route behind a drawer that is still covering the whole screen.
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                isActive
                  ? 'bg-cloistr-primary/10 text-cloistr-primary'
                  : 'text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light'
              }`
            }
          >
            {item.icon}
            {sidebarOpen && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Service status (collapsed shows dots) */}
      <div className="absolute bottom-4 left-0 right-0 px-4">
        {sidebarOpen ? (
          <div className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-3">
            <p className="mb-2 text-xs font-medium text-cloistr-light/40">Services</p>
            <div className="space-y-1">
              <RelayStatusCompact />
              {/* Read the ACTUAL probe result. These were hardcoded to
                  "pending", so the panel reported "Not wired" forever no matter
                  what the services were doing — including after NdkProvider
                  gained a real /health poll for exactly these entries. The probe
                  was landing in the store and nothing was reading it. */}
              <ServiceIndicator name="Drive" status={statusOf('drive')} />
              <ServiceIndicator name="Blossom" status={statusOf('blossom')} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <RelayStatusDot />
            <div className="h-2 w-2 rounded-full bg-cloistr-text-dim" title="Drive (pending)" />
            <div className="h-2 w-2 rounded-full bg-cloistr-text-dim" title="Blossom (pending)" />
          </div>
        )}
      </div>
      </aside>
    </>
  );
}

function ServiceIndicator({ name, status }: { name: string; status: 'connected' | 'disconnected' | 'pending' }) {
  const colors = {
    connected: 'text-cloistr-success',
    disconnected: 'text-cloistr-error',
    pending: 'text-cloistr-text-dim',
  };
  const labels = {
    connected: 'Connected',
    disconnected: 'Offline',
    pending: 'Not wired',
  };

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-cloistr-light/60">{name}</span>
      <span className={colors[status]}>{labels[status]}</span>
    </div>
  );
}
