/**
 * @fileoverview Everything that happened to you, as a surface rather than a widget.
 *
 * This existed as a five-item dashboard widget with no route and no "see all",
 * so a user had to visit the activity page to discover they had anything --
 * which is backwards, since the point of a notification is to reach someone who
 * is somewhere else.
 */

import { useMemo, useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useMentions } from '@/services/activity/useMentions';
import { useAuthorProfiles } from '@/services/profile/useAuthorProfiles';
import { NOTIFICATION_VERB, showsContent } from '@/services/activity/notificationKinds';
import { profilePath, notePath, abbreviate, encodeProfile, useNdk, type NDKFilter } from '@/services/nostr';
import { NoteContent } from '@/components/social/NoteContent';
import type { Mention } from '@/types/activity';

/** Truncate note content for a compact referenced-note preview. */
function truncate(text: string, max = 120): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max).trimEnd()}…`;
}

/** Format sats: 1000 → "1k", 1000000 → "1M". */
function formatSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(sats);
}

/**
 * Fetch the content of notes referenced by reactions and reposts.
 *
 * This is a second fetch and will sometimes fail or return nothing.
 * The caller must render each row regardless -- missing context
 * is better than a row that disappears or spins forever.
 */
function useReferencedNotes(items: Mention[]): Map<string, string> {
  const { fetchEvents, isConnected } = useNdk();
  const [noteContent, setNoteContent] = useState<Map<string, string>>(new Map());
  const attemptedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!fetchEvents || !isConnected) return;

    const idsToFetch = items
      .filter((m) => m.type === 'reaction' || m.type === 'repost')
      .map((m) => m.rootEvent ?? m.replyTo)
      .filter((id): id is string => id !== undefined && !attemptedIds.current.has(id));

    if (!idsToFetch.length) return;

    idsToFetch.forEach((id) => attemptedIds.current.add(id));

    const filter: NDKFilter = { ids: idsToFetch, kinds: [1], limit: idsToFetch.length };

    fetchEvents(filter)
      .then((events) => {
        setNoteContent((prev) => {
          const next = new Map(prev);
          events.forEach((ev) => {
            if (ev.id && ev.content) next.set(ev.id, ev.content);
          });
          return next;
        });
      })
      .catch(() => {
        // Failure is expected occasionally. Rows render without the preview.
      });
  }, [items, fetchEvents, isConnected]);

  return noteContent;
}

export function NotificationsView() {
  const { items, isLoading, error, unreadCount, markAsRead, markAllAsRead } = useMentions({
    limit: 100,
  });

  const authors = useMemo(() => items.map((m) => m.pubkey), [items]);
  const profiles = useAuthorProfiles(authors);
  const noteContent = useReferencedNotes(items);

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

      {/* Error is shown persistently, not replaced by content, because
          it distinguishes "failed to load" from "you have nothing".
          An empty list and a failed query must not look the same. */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-cloistr-light/80">
          Could not load notifications: {error}
        </div>
      )}

      {isLoading && items.length === 0 && (
        <p className="text-sm text-cloistr-light/50">Looking for activity…</p>
      )}

      {/* Said only once the subscription has settled: before that, an empty
          list and a loading list are the same picture. */}
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
          const refContent = target ? noteContent.get(target) : undefined;

          return (
            <li key={item.id}>
              <NotificationRow
                item={item}
                name={name}
                target={target}
                refContent={refContent}
                onMarkRead={() => markAsRead(item.id)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface NotificationRowProps {
  item: Mention;
  name: string;
  target: string | undefined;
  /** Content of the referenced note, if resolved. Absent means fetch is
   *  still in flight or failed -- the row renders without it either way. */
  refContent: string | undefined;
  onMarkRead: () => void;
}

function NotificationRow({ item, name, target, refContent, onMarkRead }: NotificationRowProps) {
  return (
    <article
      className={`rounded-lg border p-3 ${
        item.read
          ? 'border-cloistr-light/10 bg-cloistr-light/[0.03]'
          : 'border-cloistr-primary/30 bg-cloistr-primary/5'
      }`}
    >
      {/* First line: who did what, when */}
      <div className="flex items-baseline gap-2">
        <Link
          to={profilePath(item.pubkey)}
          className="truncate text-sm font-medium text-cloistr-light hover:underline"
        >
          {name}
        </Link>
        <span className="text-sm text-cloistr-light/60">{NOTIFICATION_VERB[item.type]}</span>
        <span className="ml-auto shrink-0 text-xs text-cloistr-light/40">
          {new Date(item.createdAt * 1000).toLocaleString()}
        </span>
      </div>

      {/* Zap: show the amount. */}
      {item.type === 'zap' && item.zapSats !== undefined && item.zapSats > 0 && (
        <p className="mt-1.5 text-sm font-medium text-amber-400">
          ⚡ {formatSats(item.zapSats)} sats
        </p>
      )}

      {/* Reaction: show the emoji, then a preview of what it landed on. */}
      {item.type === 'reaction' && (
        <div className="mt-1.5 space-y-1">
          {item.content && (
            <span className="text-base leading-none" aria-label="reaction">
              {item.content}
            </span>
          )}
          {refContent && (
            <p className="text-xs text-cloistr-light/50 line-clamp-2">
              on: {truncate(refContent)}
            </p>
          )}
        </div>
      )}

      {/* Repost: show a preview of what was reposted. */}
      {item.type === 'repost' && refContent && (
        <p className="mt-1.5 text-xs text-cloistr-light/50 line-clamp-2">
          {truncate(refContent)}
        </p>
      )}

      {/* Reply / mention: show the message body. */}
      {showsContent(item.type) && item.type !== 'reaction' && item.content && (
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
            onClick={onMarkRead}
            className="text-cloistr-light/50 hover:text-cloistr-light"
          >
            Mark read
          </button>
        )}
      </div>
    </article>
  );
}
