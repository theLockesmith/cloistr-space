/**
 * @fileoverview The badge must not render a zero.
 *
 * unreadCount was computed and displayed nowhere, so a user had to visit the
 * activity page to discover they had anything -- backwards for a feature whose
 * whole purpose is reaching someone who is elsewhere.
 *
 * A permanent "0" is the failure this codebase keeps producing in a new place:
 * a control reporting a state nobody needs told about, which trains people to
 * ignore the thing meant to catch their eye.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const badge = readFileSync(join(__dirname, 'NotificationBadge.tsx'), 'utf8');
const layout = readFileSync(join(__dirname, 'MainLayout.tsx'), 'utf8');
const view = readFileSync(
  join(__dirname, '..', 'activity', 'NotificationsView.tsx'),
  'utf8'
);

describe('notification badge', () => {
  it('renders nothing at zero', () => {
    expect(badge).toMatch(/unreadCount > 0 &&/);
  });

  it('caps the displayed number', () => {
    // Three digits widen the header and nobody acts on the difference between
    // 99 and 214.
    expect(badge).toMatch(/99\+/);
  });

  it('lives in the primary header, not per page', () => {
    // Notifications are a property of the USER, not the page. An indicator that
    // only appears where notifications "belong" is absent exactly when it would
    // be useful.
    expect(layout).toMatch(/<NotificationBadge \/>/);
  });

  it('the subheader is gone', () => {
    // A title telling you that you are on the page you just navigated to is a
    // row of vertical space spent restating the nav.
    expect(layout).not.toMatch(/<SubHeader/);
  });

  it('marking all read is reachable', () => {
    expect(view).toMatch(/markAllAsRead/);
  });

  it('mark-all is only offered when there is something to mark', () => {
    // A permanently available "mark all read" on an empty list is a control
    // that cannot do anything.
    expect(view).toMatch(/unreadCount > 0 && \(/);
  });
});
