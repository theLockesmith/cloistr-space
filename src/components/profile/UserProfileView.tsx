/**
 * @fileoverview Somebody else's profile: who they are, what they posted.
 *
 * Reached from an author name in the feed, or from a NIP-19 link pasted from
 * another client. The route parameter may be an npub, an nprofile carrying
 * relay hints, or a bare hex pubkey -- see identifiers.ts for why bare hex is
 * only accepted where the route tells us what it means.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import {
  decodeIdentifier,
  decodeHexAs,
  encodeProfile,
  abbreviate,
  notePath,
  SecretKeyPastedError,
} from '@/services/nostr';
import { useAuthorProfiles } from '@/services/profile/useAuthorProfiles';
import { useNip05 } from '@/services/profile/useNip05';
import type { Nip05State } from '@/services/profile/useNip05';
import { useAuthorNotes } from '@/services/profile/useAuthorNotes';
import { useFollow, FOLLOW_BLOCKED_MESSAGE } from '@/services/profile/useFollow';
import { NoteContent } from '@/components/social/NoteContent';

/**
 * Return src only when it has a safe absolute URL scheme (http or https).
 * A scheme-less value resolves relative to the current page.
 */
function safeImageUrl(src: string | undefined): string | null {
  if (!src) return null;
  const t = src.trim();
  if (!t.startsWith('https://') && !t.startsWith('http://')) return null;
  return t;
}

/**
 * Verification badge for a NIP-05 address. Three distinguishable states:
 *   VERIFIED   - green check
 *   UNVERIFIED - amber cross (said they are X; confirmed they are not)
 *   UNKNOWN    - grey question (network or CORS failure; could not check)
 */
function Nip05Badge({ state }: { state: Nip05State | null }) {
  if (state === null) return null;
  if (state === 'verified') {
    return (
      <span
        title="NIP-05 verified"
        className="inline-block shrink-0 text-cloistr-success"
        aria-label="verified"
      >
        ✓
      </span>
    );
  }
  if (state === 'unverified') {
    return (
      <span
        title="NIP-05 address does not match this pubkey"
        className="inline-block shrink-0 text-cloistr-warning"
        aria-label="not verified"
      >
        ✗
      </span>
    );
  }
  return (
    <span
      title="NIP-05 could not be checked (network or CORS)"
      className="inline-block shrink-0 text-cloistr-light/30"
      aria-label="verification unknown"
    >
      ?
    </span>
  );
}

export function UserProfileView() {
  const { id = '' } = useParams();

  // Decoding can THROW for an nsec, and that must not reach an error boundary
  // as a generic crash -- the user needs to be told what they just pasted.
  const resolved = useMemo(() => {
    try {
      return { value: decodeIdentifier(id) ?? decodeHexAs(id, 'profile'), secret: false };
    } catch (e) {
      if (e instanceof SecretKeyPastedError) return { value: null, secret: true };
      throw e;
    }
  }, [id]);

  if (resolved.secret) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <div className="rounded-lg border border-cloistr-error/40 bg-cloistr-error/10 p-4">
          <h1 className="font-medium text-cloistr-error">That is a private key</h1>
          <p className="mt-2 text-sm text-cloistr-light/80">
            You pasted an <code>nsec</code>, which is your secret key, not a link. It has not been
            used or stored. If you pasted it anywhere else, treat it as compromised and rotate it.
          </p>
        </div>
      </div>
    );
  }

  if (!resolved.value || resolved.value.type !== 'profile') {
    return <Navigate to="/social" replace />;
  }

  return <ProfileBody pubkey={resolved.value.pubkey} />;
}

function ProfileBody({ pubkey }: { pubkey: string }) {
  const navigate = useNavigate();
  const profiles = useAuthorProfiles(useMemo(() => [pubkey], [pubkey]));
  const { notes, isLoading } = useAuthorNotes(pubkey);
  const follow = useFollow(pubkey);

  const profile = profiles.get(pubkey);
  const nip05State = useNip05(profile?.nip05, pubkey);
  const name = profile?.displayName || profile?.name || abbreviate(encodeProfile(pubkey));

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <header className="flex items-start gap-4">
        {safeImageUrl(profile?.picture) ? (
          <img
            src={safeImageUrl(profile?.picture)!}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full object-cover"
            // A dead avatar host must not leave a broken-image glyph.
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <div className="h-16 w-16 shrink-0 rounded-full bg-cloistr-primary/20" />
        )}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-medium text-cloistr-light">{name}</h1>
          {profile?.nip05 && (
            <p className="flex items-center gap-1.5 text-sm text-cloistr-light/60">
              <span className="truncate">{profile.nip05}</span>
              <Nip05Badge state={nip05State} />
            </p>
          )}
          {profile?.lud16 && (
            <p className="truncate text-sm text-cloistr-light/50">
              &#x26A1; {profile.lud16}
            </p>
          )}
          <p className="mt-1 break-all font-mono text-xs text-cloistr-light/40">
            {abbreviate(encodeProfile(pubkey), 12)}
          </p>
          {profile?.about && (
            <div className="mt-2">
              <NoteContent content={profile.about} compact />
            </div>
          )}
        </div>

        <FollowButton follow={follow} />
      </header>

      {/* Said once, at the top, rather than silently disabling the button. */}
      {follow.blockedReason && follow.blockedReason !== 'self' && (
        <p role="status" className="text-xs text-cloistr-light/50">
          {FOLLOW_BLOCKED_MESSAGE[follow.blockedReason]}
        </p>
      )}

      {follow.error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-cloistr-error/30 bg-cloistr-error/5 p-3 text-sm text-cloistr-light/80"
        >
          <span>{follow.error}</span>
          <button
            onClick={follow.dismissError}
            className="shrink-0 text-xs text-cloistr-primary underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-cloistr-light/60">Notes</h2>

        {isLoading && notes.length === 0 && (
          <p className="text-sm text-cloistr-light/50">Loading notes…</p>
        )}

        {/* "Nothing here" and "we could not reach a relay" are different, and
            this only knows the first once loading has settled. */}
        {!isLoading && notes.length === 0 && (
          <p className="text-sm text-cloistr-light/50">
            No notes found for this person on the relays we can reach.
          </p>
        )}

        {/* Cards, not list rows. The operator could not tell where one post
            ended and the next began -- borders and spacing are the fix, and
            they are not decoration. */}
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id}>
              <article className="relative rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4">
                <Link
                  to={notePath(note.id, [], note.pubkey)}
                  aria-label="Open this post"
                  className="absolute inset-0 z-0"
                />
                <div className="relative z-10 pointer-events-none [&_a]:pointer-events-auto [&_img]:pointer-events-auto [&_video]:pointer-events-auto">
                  <NoteContent content={note.content} />
                  <p className="mt-2 text-xs text-cloistr-light/40">
                    {new Date(note.createdAt * 1000).toLocaleString()}
                  </p>
                </div>
              </article>
            </li>
          ))}
        </ul>
      </section>

      <button
        onClick={() => navigate(-1)}
        className="text-sm text-cloistr-primary underline hover:no-underline"
      >
        Back
      </button>
    </div>
  );
}

function FollowButton({ follow }: { follow: ReturnType<typeof useFollow> }) {
  // Nothing to offer on your own profile, so nothing is shown -- a disabled
  // "Follow" on yourself is noise, not information.
  if (follow.blockedReason === 'self') return null;

  const disabled = follow.blockedReason !== null || follow.isBusy;

  return (
    <button
      onClick={() => void follow.toggle()}
      disabled={disabled}
      aria-disabled={disabled}
      className={`shrink-0 rounded px-3 py-1.5 text-sm ${
        disabled
          ? 'cursor-not-allowed bg-cloistr-light/10 text-cloistr-light/30'
          : follow.isFollowing
            ? 'border border-cloistr-light/20 text-cloistr-light/80 hover:border-cloistr-error/50 hover:text-cloistr-error'
            : 'bg-cloistr-primary text-cloistr-dark'
      }`}
    >
      {follow.isBusy ? 'Saving…' : follow.isFollowing ? 'Following' : 'Follow'}
    </button>
  );
}
