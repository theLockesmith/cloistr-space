/**
 * @fileoverview Unread count, in the primary header.
 *
 * unreadCount was computed and displayed nowhere, so a user had to visit the
 * activity page to discover they had anything -- which is backwards.
 *
 * IN THE PRIMARY HEADER, not per-page. Notifications are a property of the
 * USER, not of the page: you have unread mentions whether you are looking at
 * the feed, a project or your profile, and the whole point is to surface them
 * when you are somewhere else. An indicator that only appears on pages that
 * "have" notifications is absent exactly when it would be useful.
 *
 * ZERO RENDERS NOTHING. A permanent "0" is a control reporting a state nobody
 * needs told about, and it trains people to ignore the thing that is supposed
 * to catch their eye -- the same class as a spinner that never resolves.
 */

import { Link } from 'react-router-dom';
import { useMentions } from '@/services/activity/useMentions';

export function NotificationBadge() {
  // A count, not a list: this only needs to know whether there is anything.
  const { unreadCount } = useMentions({ limit: 50 });

  return (
    <Link
      to="/notifications"
      aria-label={
        unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
      }
      className="relative flex h-9 w-9 items-center justify-center rounded text-cloistr-light/60 hover:bg-cloistr-light/10 hover:text-cloistr-light"
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1h6z" />
      </svg>

      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-cloistr-primary px-1 text-center text-[11px] font-medium leading-[18px] text-cloistr-dark">
          {/* Capped: a three-digit count widens the header and nobody acts on
              the difference between 99 and 214. */}
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
