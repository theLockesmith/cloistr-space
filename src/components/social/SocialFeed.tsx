/**
 * @fileoverview Social feed component
 * Displays notes from following/WoT/global with compose and actions
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { profilePath, notePath } from '@/services/nostr';
import { useFeed, useCompose, useNoteActions } from '@/services/social';
import { useEmojiSets } from '@/services/social/useEmojiSets';
import { reactionPayload, type EmojiEntry } from '@/services/social/emojiSets';
import { useLongPressMenu } from '@/services/social/useLongPressMenu';
import { ReactionPicker } from './ReactionPicker';
import { ShareMenu } from './ShareMenu';
import { NoteContent } from './NoteContent';
import { useAuthorProfiles } from '@/services/profile';
import { ACTION_BLOCKED_MESSAGE } from '@/services/social/useNoteActions';
import type { Note, FeedMode, AuthorProfile } from '@/types/social';

export function SocialFeed() {
  const {
    notes,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
    setMode,
    mode,
    followingCount,
    markReacted,
    getOwnReactionId,
    getOwnRepostId,
    markReposted,
  } = useFeed();
  const { post, isPosting, error: composeError, canPost } = useCompose();
  const { react, repost, undo, canAct, blockedReason } = useNoteActions();
  const { emoji, isLoading: emojiLoading } = useEmojiSets();

  // kind:0 for everyone currently on screen. Nothing populated note.authorProfile
  // before this, so every card fell back to a truncated pubkey.
  const authorPubkeys = useMemo(() => notes.map((n) => n.pubkey), [notes]);
  const authorProfiles = useAuthorProfiles(authorPubkeys);

  const [composeText, setComposeText] = useState('');
  // Publish failures were caught and console.error'd only, so a refused action
  // was as invisible as a working one. Optimism without this would be worse
  // than the original bug: the user would trust something that did not happen.
  const [actionError, setActionError] = useState<string | null>(null);
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
    async (note: Note, entry?: EmojiEntry) => {
      if (!canAct) return;

      // Tapping a filled heart RETRACTS it. Until now this returned early, so
      // the control was inert once used -- "I can no longer un-heart posts".
      // It never worked; it only became reachable when reactions started
      // persisting, so the operator met it as a regression.
      if (!entry && note.userReacted) {
        const reactionId = getOwnReactionId(note.id);
        if (!reactionId) {
          // We know they reacted but not with which event, so there is nothing
          // to reference in a kind:5. Saying so beats doing nothing.
          setActionError(
            'Cannot undo this reaction yet — still loading which one was yours.'
          );
          return;
        }

        setActionError(null);
        markReacted(note.id, false);
        try {
          await undo(reactionId);
        } catch (err) {
          markReacted(note.id, true, reactionId);
          setActionError(
            err instanceof Error ? `Reaction not removed. ${err.message}` : 'Reaction not removed.'
          );
        }
        return;
      }

      setActionError(null);
      markReacted(note.id, true);

      const payload = entry ? reactionPayload(entry) : null;

      try {
        const outcome = await react(note.id, note.pubkey, payload?.content, payload?.tags);
        // Record what we just sent so it can be undone immediately, rather than
        // only once the relay echo comes back.
        markReacted(note.id, true, outcome.eventId);
      } catch (err) {
        // Take it back visibly. A reverted heart is honest; a stuck-filled one
        // claims something happened that did not.
        markReacted(note.id, false);
        setActionError(
          err instanceof Error ? `Reaction not sent. ${err.message}` : 'Reaction not sent.'
        );
      }
    },
    [canAct, react, undo, markReacted, getOwnReactionId]
  );

  const handleRepost = useCallback(
    async (note: Note) => {
      if (!canAct) return;

      // Same as the heart: tapping an active repost retracts it.
      if (note.userReposted) {
        const repostId = getOwnRepostId(note.id);
        if (!repostId) {
          setActionError('Cannot undo this repost yet — still loading which one was yours.');
          return;
        }

        setActionError(null);
        markReposted(note.id, false);
        try {
          await undo(repostId);
        } catch (err) {
          markReposted(note.id, true, repostId);
          setActionError(
            err instanceof Error ? `Repost not removed. ${err.message}` : 'Repost not removed.'
          );
        }
        return;
      }

      setActionError(null);
      markReposted(note.id, true);

      try {
        const outcome = await repost(note.id, note.pubkey);
        markReposted(note.id, true, outcome.eventId);
      } catch (err) {
        markReposted(note.id, false);
        setActionError(
          err instanceof Error ? `Repost not sent. ${err.message}` : 'Repost not sent.'
        );
      }
    },
    [canAct, repost, undo, markReposted, getOwnRepostId]
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
          <p className="mt-2 text-sm text-cloistr-error">{composeError}</p>
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
            className="rounded-lg bg-cloistr-primary px-4 py-2 text-sm font-medium text-cloistr-primary-fg hover:bg-cloistr-primary/90 disabled:opacity-50"
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

      {/* Why actions are unavailable, stated once rather than under every note.
          Rendered as text, not a title attribute -- this was reported from a
          phone, where nothing hovers, and the whole reason it took a round trip
          to locate is that a blocked button looked identical to a working one. */}
      {blockedReason && (
        <div
          role="status"
          className="rounded-lg border border-cloistr-warning/30 bg-cloistr-warning/5 px-4 py-2 text-sm text-cloistr-light/70"
        >
          {ACTION_BLOCKED_MESSAGE[blockedReason]}
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-cloistr-error/30 bg-cloistr-error/5 px-4 py-2 text-sm text-cloistr-light/80"
        >
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-cloistr-light/40 hover:text-cloistr-light"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-cloistr-error/20 bg-cloistr-error/5 p-4 text-center">
          <p className="text-sm text-cloistr-error">{error}</p>
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
          {(mode === 'following' || mode === 'wot') && followingCount === 0 ? (
            <>
              {/* Not "no notes" -- we never ran a query. The following and wot
                  filters need authors, so with no contacts they are skipped
                  entirely. Saying "follow some people" here is wrong and
                  actively misleading for the common case: the user very likely
                  does follow people, in a kind:3 list that this app has not
                  imported into its kind:33000 store yet. */}
              <h3 className="mb-2 font-medium text-cloistr-light">No contacts yet</h3>
              <p className="text-sm text-cloistr-light/60">
                This feed is built from your contact list, which is empty. If you already follow
                people with another Nostr app, import them from the Activity page to see their
                notes here.
              </p>
            </>
          ) : (
            <>
              <h3 className="mb-2 font-medium text-cloistr-light">No notes yet</h3>
              <p className="text-sm text-cloistr-light/60">
                {mode === 'following' || mode === 'wot'
                  ? `Nothing found from the ${followingCount} ${
                      followingCount === 1 ? 'contact' : 'contacts'
                    } in your list.`
                  : 'No notes found in this feed'}
              </p>
            </>
          )}
        </div>
      )}

      {/* Feed */}
      <div className="space-y-4">
        {notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            profile={authorProfiles.get(note.pubkey)}
            canAct={canAct}
            onReact={() => handleReact(note)}
            onPickReaction={(entry) => handleReact(note, entry)}
            emoji={emoji}
            emojiLoading={emojiLoading}
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
  profile,
  canAct,
  onReact,
  onPickReaction,
  emoji,
  emojiLoading,
  onRepost,
}: {
  note: Note;
  profile?: AuthorProfile;
  canAct: boolean;
  onReact: () => void;
  onPickReaction: (entry: EmojiEntry) => void;
  emoji: EmojiEntry[];
  emojiLoading: boolean;
  onRepost: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  // Plain click still sends the default heart. Hold, right-click or ArrowDown
  // open the picker instead.
  const { handlers: reactHandlers } = useLongPressMenu({
    onOpen: () => setPickerOpen(true),
    onActivate: onReact,
    disabled: !canAct,
  });

  // Prefer the resolved profile; note.authorProfile stays supported so a caller
  // that already has one is not forced through the lookup.
  const author = profile ?? note.authorProfile;
  const displayName = author?.displayName || author?.name || formatPubkey(note.pubkey);
  const timeStr = formatTime(note.createdAt);

  return (
    <article className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4">
      {/* Author.
          A real <Link>, not an onClick div: middle-click, open-in-new-tab and
          copy-link-address are how people actually use a name in a feed, and a
          click handler silently breaks all three. */}
      <div className="mb-3 flex items-center gap-3">
        <Link to={profilePath(note.pubkey)} aria-label={`${displayName}'s profile`}>
          {author?.picture ? (
            <img
              src={author.picture}
              alt=""
              className="h-10 w-10 rounded-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cloistr-primary/20 text-sm font-medium text-cloistr-primary">
              {displayName.slice(0, 2).toUpperCase()}
            </div>
          )}
        </Link>
        {/* min-w-0: a flex child defaults to min-width:auto and will not
            shrink below its content, so a long display name widens the card
            and then the page. truncate keeps the name on one line. */}
        <div className="min-w-0">
          <Link
            to={profilePath(note.pubkey)}
            className="block truncate font-medium text-cloistr-light hover:underline"
          >
            {displayName}
          </Link>
          <p className="text-xs text-cloistr-light/60">{timeStr}</p>
        </div>
      </div>

      {/* Content */}
      {/* The whole post body is a link target, but the CONTENT is not wrapped
          in an <a>: it contains its own links, mentions and hashtags, and
          nesting anchors is invalid HTML that browsers resolve unpredictably.
          A separate overlay link keeps both working. */}
      <div className="relative mb-4">
        <Link
          to={notePath(note.id, [], note.pubkey)}
          aria-label="Open this post"
          className="absolute inset-0 z-0"
        />
        <div className="relative z-10 pointer-events-none [&_a]:pointer-events-auto [&_img]:pointer-events-auto [&_video]:pointer-events-auto">
          <NoteContent content={note.content} />
        </div>
      </div>

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

      {/* Actions.
          Every control carries disabled AND aria-disabled, and the reason is
          rendered as text below rather than in a title attribute: the operator
          reported this on mobile, where there is no hover. */}
      <div className="flex items-center gap-6 border-t border-cloistr-light/10 pt-3">
        {/* The thread view exists now, so this navigates instead of sitting
            disabled. A Link rather than an onClick: opening a post in a new tab
            is ordinary, and a click handler breaks it silently. */}
        <Link
          to={notePath(note.id, [], note.pubkey)}
          aria-label={`Replies to this post (${note.engagement.replies})`}
          className="flex items-center gap-2 text-sm text-cloistr-light/40 hover:text-cloistr-primary"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {note.engagement.replies > 0 && note.engagement.replies}
        </Link>
        <button
          onClick={onRepost}
          disabled={!canAct}
          aria-disabled={!canAct}
          className={`flex items-center gap-2 text-sm ${
            canAct
              ? 'text-cloistr-light/40 hover:text-cloistr-success'
              : 'cursor-not-allowed text-cloistr-light/20'
          }`}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {note.engagement.reposts > 0 && note.engagement.reposts}
        </button>
        {/* relative so the picker anchors to THIS button. The container must
            not be the note or the feed, or the menu detaches on scroll. */}
        <div className="relative">
          <button
            {...reactHandlers}
            disabled={!canAct}
            aria-disabled={!canAct}
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            title={canAct ? 'Click to react. Hold or right-click to choose an emoji.' : undefined}
            className={`flex items-center gap-2 text-sm ${
              !canAct
                ? 'cursor-not-allowed text-cloistr-light/20'
                : note.userReacted
                  ? 'text-cloistr-error'
                  : 'text-cloistr-light/40 hover:text-cloistr-error'
            }`}
          >
            <svg className="h-5 w-5" fill={note.userReacted ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
            {note.engagement.reactions > 0 && note.engagement.reactions}
          </button>

          {pickerOpen && (
            <ReactionPicker
              emoji={emoji}
              isLoading={emojiLoading}
              onPick={(entry) => {
                setPickerOpen(false);
                onPickReaction(entry);
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
        {/* Zapping needs NIP-57, which is not implemented. */}
        <button
          disabled
          aria-disabled="true"
          aria-label="Zaps (not available yet)"
          className="flex cursor-not-allowed items-center gap-2 text-sm text-cloistr-light/20"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          {note.engagement.zapAmount > 0 && formatSats(note.engagement.zapAmount)}
        </button>
        <ShareMenu noteId={note.id} authorPubkey={note.pubkey} />
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
          ? 'bg-cloistr-primary text-cloistr-primary-fg'
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
