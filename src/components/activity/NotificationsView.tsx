/**
 * @fileoverview Everything that happened to you, as a surface rather than a widget.
 *
 * This existed as a five-item dashboard widget with no route and no "see all",
 * so a user had to visit the activity page to discover they had anything --
 * which is backwards, since the point of a notification is to reach someone who
 * is somewhere else.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useMentions } from '@/services/activity/useMentions';
import { useAuthorProfiles } from '@/services/profile/useAuthorProfiles';
import { NOTIFICATION_VERB, showsContent } from '@/services/activity/notificationKinds';
import { profilePath, notePath, abbreviate, encodeProfile } from '@/services/nostr';
import { NoteContent } from '@/components/social/NoteContent';

export function NotificationsView() {
  const { items, isLoading, error, unreadCount, markAsRead, markAllAsRead } = useMentions({
    limit: 100,
  });

  const authors = useMemo(() => items.map((m) => m.pubkey), [items]);
  const profiles = useAuthorProfiles(authors);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-cloistr-light">Notifications</h1>
          <p className="mt-1 text-sm text-cloistr-light/60">
            Replies, mentions, reactions, reposts and zaps.
          </p>
        </div>
        {/* Only offered when there is something to mark. A permanently
            available "mark all read" on an empty list is a control that
            cannot do anything. */}
        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            className="shrink-0 rounded border border-cloistr-light/20 px-3 py-1.5 text-sm text-cloistr-light/80 hover:bg-cloistr-light/5"
          >
            Mark all read
          </button>
        )}
      </header>

      {error && (
        <div className="rounded-lg border border-cloistr-error/30 bg-cloistr-error/5 p-3 text-sm text-cloistr-light/80">
          {error}
        </div>
      )}

      {isLoading && items.length === 0 && (
        <p className="text-sm text-cloistr-light/50">Looking for activity…</p>
      )}

      {/* Said only once loading has settled: before that, "nothing" and "not
          yet" are the same picture. */}
      {!isLoading && items.length === 0 && !error && (
        <div className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-6 text-center">
          <h2 className="mb-1 font-medium text-cloistr-light">Nothing yet</h2>
          <p className="text-sm text-cloistr-light/60">
            When someone replies to you, mentions you, or reacts to your posts, it shows up here.
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {items.map((item) => {
          const p = profiles.get(item.pubkey);
          const name = p?.displayName || p?.name || abbreviate(encodeProfile(item.pubkey));
          const target = item.rootEvent ?? item.replyTo;

          return (
            <li key={item.id}>
              <article
                className={`rounded-lg border p-3 ${
                  item.read
                    ? 'border-cloistr-light/10 bg-cloistr-light/[0.03]'
                    : 'border-cloistr-primary/30 bg-cloistr-primary/5'
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <Link
                    to={profilePath(item.pubkey)}
                    className="truncate text-sm font-medium text-cloistr-light hover:underline"
                  >
                    {name}
                  </Link>
                  <span className="text-sm text-cloistr-light/60">
                    {NOTIFICATION_VERB[item.type]}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-cloistr-light/40">
                    {new Date(item.createdAt * 1000).toLocaleString()}
                  </span>
                </div>

                {showsContent(item.type) && item.content && (
                  <div className="mt-2">
                    <NoteContent content={item.content} compact />
                  </div>
                )}

                <div className="mt-2 flex gap-3 text-xs">
                  {/* Only when we know what it refers to. A "view post" link
                      pointing nowhere is the inert-control problem again. */}
                  {target && (
                    <Link to={notePath(target)} className="text-cloistr-primary hover:underline">
                      View post
                    </Link>
                  )}
                  {!item.read && (
                    <button
                      onClick={() => markAsRead(item.id)}
                      className="text-cloistr-light/50 hover:text-cloistr-light"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
