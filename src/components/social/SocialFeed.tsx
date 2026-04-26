/**
 * @fileoverview Social feed component
 * Displays notes from following/WoT/global with compose and actions
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useFeed, useCompose, useNoteActions } from '@/services/social';
import type { Note, FeedMode } from '@/types/social';

export function SocialFeed() {
  const { notes, isLoading, error, hasMore, loadMore, refresh, setMode, mode } = useFeed();
  const { post, isPosting, error: composeError, canPost } = useCompose();
  const { react, repost, canAct } = useNoteActions();

  const [composeText, setComposeText] = useState('');
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Infinite scroll observer
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [hasMore, isLoading, loadMore]);

  const handlePost = useCallback(async () => {
    if (!composeText.trim() || isPosting) return;

    try {
      await post(composeText);
      setComposeText('');
      refresh();
    } catch {
      // Error is handled by hook
    }
  }, [composeText, isPosting, post, refresh]);

  const handleReact = useCallback(
    async (note: Note) => {
      if (!canAct) return;
      try {
        await react(note.id, note.pubkey);
      } catch (err) {
        console.error('Failed to react:', err);
      }
    },
    [canAct, react]
  );

  const handleRepost = useCallback(
    async (note: Note) => {
      if (!canAct) return;
      try {
        await repost(note.id, note.pubkey);
      } catch (err) {
        console.error('Failed to repost:', err);
      }
    },
    [canAct, repost]
  );

  const handleModeChange = useCallback(
    (newMode: FeedMode) => {
      setMode(newMode);
    },
    [setMode]
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Compose */}
      <div className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4">
        <textarea
          value={composeText}
          onChange={(e) => setComposeText(e.target.value)}
          placeholder="What's on your mind?"
          rows={3}
          disabled={!canPost || isPosting}
          className="w-full resize-none rounded-lg border border-cloistr-light/10 bg-transparent p-3 text-sm text-cloistr-light placeholder-cloistr-light/40 focus:border-cloistr-primary focus:outline-none disabled:opacity-50"
        />
        {composeError && (
          <p className="mt-2 text-sm text-red-400">{composeError}</p>
        )}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              className="rounded-lg p-2 text-cloistr-light/40 hover:bg-cloistr-light/5 hover:text-cloistr-light"
              title="Add image"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
            <button
              className="rounded-lg p-2 text-cloistr-light/40 hover:bg-cloistr-light/5 hover:text-cloistr-light"
              title="Add link"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </button>
          </div>
          <button
            onClick={handlePost}
            disabled={!canPost || !composeText.trim() || isPosting}
            className="rounded-lg bg-cloistr-primary px-4 py-2 text-sm font-medium text-white hover:bg-cloistr-primary/90 disabled:opacity-50"
          >
            {isPosting ? 'Posting...' : 'Post'}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-4 rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-4 py-2">
        <span className="text-sm text-cloistr-light/60">Filter:</span>
        <div className="flex gap-2">
          <FilterButton active={mode === 'following'} onClick={() => handleModeChange('following')}>
            Following
          </FilterButton>
          <FilterButton active={mode === 'wot'} onClick={() => handleModeChange('wot')}>
            WoT
          </FilterButton>
          <FilterButton active={mode === 'global'} onClick={() => handleModeChange('global')}>
            Global
          </FilterButton>
        </div>
        <div className="ml-auto">
          <button
            onClick={refresh}
            className="flex items-center gap-1 text-sm text-cloistr-light/40 hover:text-cloistr-light"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={refresh} className="mt-2 text-xs text-cloistr-primary underline hover:no-underline">
            Try again
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && notes.length === 0 && (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4">
              <div className="mb-3 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-cloistr-light/10" />
                <div className="space-y-2">
                  <div className="h-4 w-24 rounded bg-cloistr-light/10" />
                  <div className="h-3 w-16 rounded bg-cloistr-light/10" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-4 w-full rounded bg-cloistr-light/10" />
                <div className="h-4 w-3/4 rounded bg-cloistr-light/10" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && notes.length === 0 && (
        <div className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-cloistr-light/10">
            <svg className="h-6 w-6 text-cloistr-light/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="mb-2 font-medium text-cloistr-light">No notes yet</h3>
          <p className="text-sm text-cloistr-light/60">
            {mode === 'following'
              ? 'Follow some people to see their notes here'
              : 'No notes found in this feed'}
          </p>
        </div>
      )}

      {/* Feed */}
      <div className="space-y-4">
        {notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            onReact={() => handleReact(note)}
            onRepost={() => handleRepost(note)}
          />
        ))}
      </div>

      {/* Load more trigger */}
      {hasMore && (
        <div ref={loadMoreRef} className="flex justify-center py-4">
          {isLoading ? (
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cloistr-primary border-t-transparent" />
          ) : (
            <button
              onClick={loadMore}
              className="text-sm text-cloistr-light/60 hover:text-cloistr-light"
            >
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NoteCard({
  note,
  onReact,
  onRepost,
}: {
  note: Note;
  onReact: () => void;
  onRepost: () => void;
}) {
  const displayName = note.authorProfile?.displayName || note.authorProfile?.name || formatPubkey(note.pubkey);
  const timeStr = formatTime(note.createdAt);

  return (
    <article className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4">
      {/* Author */}
      <div className="mb-3 flex items-center gap-3">
        {note.authorProfile?.picture ? (
          <img
            src={note.authorProfile.picture}
            alt=""
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cloistr-primary/20 text-sm font-medium text-cloistr-primary">
            {displayName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div>
          <p className="font-medium text-cloistr-light">{displayName}</p>
          <p className="text-xs text-cloistr-light/60">{timeStr}</p>
        </div>
      </div>

      {/* Content */}
      <p className="mb-4 whitespace-pre-wrap text-sm text-cloistr-light/90">{note.content}</p>

      {/* Media */}
      {note.media.length > 0 && (
        <div className="mb-4 grid gap-2">
          {note.media.slice(0, 4).map((media, i) => (
            <div key={i} className="overflow-hidden rounded-lg">
              {media.mimeType?.startsWith('video/') ? (
                <video src={media.url} controls className="max-h-96 w-full object-contain" />
              ) : (
                <img src={media.url} alt="" className="max-h-96 w-full object-contain" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-6 border-t border-cloistr-light/10 pt-3">
        <button className="flex items-center gap-2 text-sm text-cloistr-light/40 hover:text-cloistr-light">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {note.engagement.replies > 0 && note.engagement.replies}
        </button>
        <button
          onClick={onRepost}
          className="flex items-center gap-2 text-sm text-cloistr-light/40 hover:text-green-400"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {note.engagement.reposts > 0 && note.engagement.reposts}
        </button>
        <button
          onClick={onReact}
          className={`flex items-center gap-2 text-sm ${
            note.userReacted ? 'text-red-400' : 'text-cloistr-light/40 hover:text-red-400'
          }`}
        >
          <svg className="h-5 w-5" fill={note.userReacted ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
          {note.engagement.reactions > 0 && note.engagement.reactions}
        </button>
        <button className="flex items-center gap-2 text-sm text-cloistr-light/40 hover:text-cloistr-accent">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          {note.engagement.zapAmount > 0 && formatSats(note.engagement.zapAmount)}
        </button>
        <button className="ml-auto text-cloistr-light/40 hover:text-cloistr-light">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        </button>
      </div>
    </article>
  );
}

function FilterButton({
  children,
  active = false,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-sm transition-colors ${
        active
          ? 'bg-cloistr-primary text-white'
          : 'text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light'
      }`}
    >
      {children}
    </button>
  );
}

function formatPubkey(pubkey: string): string {
  return pubkey.slice(0, 8) + '...';
}

function formatTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;

  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatSats(sats: number): string {
  if (sats >= 1000000) {
    return `${(sats / 1000000).toFixed(1)}M`;
  }
  if (sats >= 1000) {
    return `${(sats / 1000).toFixed(1)}k`;
  }
  return sats.toString();
}
