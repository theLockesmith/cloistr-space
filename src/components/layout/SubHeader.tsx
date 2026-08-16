import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useWorkspaceStore } from '@/stores/workspaceStore';

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
      <NotificationsBell />
    </div>
  );
}

/**
 * The bell had NO onClick and a hardcoded badge dot — it was decorative markup
 * that always showed "you have notifications" and did nothing when clicked.
 *
 * The workspace store has carried real `notifications` state, with
 * addNotification/dismissNotification, the whole time. Nothing read it. This
 * connects the two: the badge now reflects actual unread notifications, and the
 * button opens a panel listing them.
 */
function NotificationsBell() {
  const notifications = useWorkspaceStore((s) => s.notifications);
  const dismissNotification = useWorkspaceStore((s) => s.dismissNotification);
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!isOpen) return;

    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const toggle = useCallback(() => setIsOpen((open) => !open), []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="relative rounded-lg p-2 text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {/* Only shown when there is genuinely something unread. */}
        {unread > 0 && (
          <span
            className="absolute right-1 top-1 h-2 w-2 rounded-full bg-cloistr-accent"
            aria-hidden="true"
          />
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-cloistr-light/10 bg-cloistr-dark shadow-lg"
        >
          <div className="border-b border-cloistr-light/10 px-4 py-2 text-sm font-medium text-cloistr-light">
            Notifications
          </div>

          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-cloistr-light/50">
              Nothing yet.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className="flex items-start justify-between gap-2 border-b border-cloistr-light/5 px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-cloistr-light">{n.title}</p>
                    {n.message && (
                      <p className="mt-0.5 text-xs text-cloistr-light/60">{n.message}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`Dismiss ${n.title}`}
                    onClick={() => dismissNotification(n.id)}
                    className="shrink-0 rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
