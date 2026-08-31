/**
 * @fileoverview Notes carrying a hashtag.
 *
 * Hashtags were parsed and stored on every note and led nowhere -- rendering
 * them as links without a destination would have been the inert-control
 * problem again, so the route ships with the renderer that creates the links.
 *
 * Global mode deliberately: a tag is a discovery surface. Restricting it to
 * people you already follow would make it a strictly worse version of the
 * following feed.
 */

import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useFeed } from '@/services/social';
import { useAuthorProfiles } from '@/services/profile/useAuthorProfiles';
import { notePath, profilePath, abbreviate, encodeProfile } from '@/services/nostr';
import { NoteContent } from './NoteContent';

export function HashtagView() {
  const { tag = '' } = useParams();
  const normalized = tag.toLowerCase();

  const { notes, isLoading, error } = useFeed({ mode: 'global', hashtag: normalized });

  const authors = useMemo(() => notes.map((n) => n.pubkey), [notes]);
  const profiles = useAuthorProfiles(authors);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header>
        <h1 className="text-xl font-medium text-cloistr-light">#{normalized}</h1>
        <p className="mt-1 text-sm text-cloistr-light/60">
          Posts tagged #{normalized}, from across the relays we can reach.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-cloistr-error/30 bg-cloistr-error/5 p-3 text-sm text-cloistr-light/80">
          {error}
        </div>
      )}

      {isLoading && notes.length === 0 && (
        <p className="text-sm text-cloistr-light/50">Looking for posts…</p>
      )}

      {/* Only said once loading has settled. Before that it is
          indistinguishable from still looking. */}
      {!isLoading && notes.length === 0 && !error && (
        <div className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-6 text-center">
          <h2 className="mb-1 font-medium text-cloistr-light">Nothing tagged #{normalized}</h2>
          <p className="text-sm text-cloistr-light/60">
            No posts with this tag on the relays we can reach. Other relays may carry some.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {notes.map((note) => {
          const p = profiles.get(note.pubkey);
          const name = p?.displayName || p?.name || abbreviate(encodeProfile(note.pubkey));

          return (
            <li key={note.id}>
              <article className="relative rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4">
                <Link
                  to={notePath(note.id, [], note.pubkey)}
                  aria-label="Open this post"
                  className="absolute inset-0 z-0"
                />
                <div className="relative z-10 pointer-events-none [&_a]:pointer-events-auto [&_img]:pointer-events-auto [&_video]:pointer-events-auto">
                  <div className="mb-2 flex items-center gap-2">
                    <Link
                      to={profilePath(note.pubkey)}
                      className="truncate text-sm font-medium text-cloistr-light hover:underline"
                    >
                      {name}
                    </Link>
                    <span className="shrink-0 text-xs text-cloistr-light/40">
                      {new Date(note.createdAt * 1000).toLocaleString()}
                    </span>
                  </div>
                  <NoteContent content={note.content} />
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
