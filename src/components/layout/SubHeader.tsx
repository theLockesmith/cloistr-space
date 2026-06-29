import { useLocation } from 'react-router-dom';

const viewTitles: Record<string, string> = {
  '/activity': 'Activity',
  '/projects': 'Projects',
  '/social': 'Social',
};

/**
 * Space-specific contextual bar shown directly below the shared Cloistr navbar.
 * Renders the current view title and notifications — NOT a second navbar.
 */
export function SubHeader() {
  const location = useLocation();
  const title = viewTitles[location.pathname] ?? 'Cloistr Space';

  return (
    <div className="flex h-12 items-center justify-between border-b border-cloistr-light/10 bg-cloistr-dark px-6">
      <h1 className="text-lg font-semibold text-cloistr-light">{title}</h1>
      {/* Notifications */}
      <button
        aria-label="Notifications"
        className="relative rounded-lg p-2 text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-cloistr-accent" aria-hidden="true" />
      </button>
    </div>
  );
}
