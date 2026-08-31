/**
 * @fileoverview Render note content: images, links, mentions, hashtags.
 *
 * Posts were rendering as unformatted text with raw URLs. This turns them into
 * something readable, without ever handing control to whoever wrote the note.
 *
 * NOTHING HERE EMITS HTML. The obvious way to make links clickable is to build
 * an HTML string and use dangerouslySetInnerHTML, which hands script execution
 * to a stranger. parseNoteContent returns a typed list and React renders it as
 * elements, so a hostile note is at worst ugly.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { parseNoteContent, type Segment } from '@/services/social/noteContent';
import { decodeIdentifier, profilePath, notePath, abbreviate } from '@/services/nostr';
import { useAuthorProfiles } from '@/services/profile/useAuthorProfiles';

interface Props {
  content: string;
  /** Suppress media, for dense contexts like a reply preview. */
  compact?: boolean;
}

export function NoteContent({ content, compact = false }: Props) {
  const segments = useMemo(() => parseNoteContent(content), [content]);

  // Mentioned pubkeys, so an npub can render as a name instead of gibberish.
  const mentioned = useMemo(() => {
    const out: string[] = [];
    for (const s of segments) {
      if (s.type !== 'entity') continue;
      try {
        const decoded = decodeIdentifier(s.id);
        if (decoded?.type === 'profile') out.push(decoded.pubkey);
      } catch {
        // An unparseable entity renders as its own text. Never throws here --
        // decodeIdentifier throws only for nsec, which is caught below too.
      }
    }
    return out;
  }, [segments]);

  const profiles = useAuthorProfiles(mentioned);

  return (
    <div className="space-y-2">
      {/* whitespace-pre-wrap: line breaks are content the author chose, and
          collapsing them turns a structured post into a wall. break-words stops
          a long unbroken URL widening the card and then the page. */}
      <p className="whitespace-pre-wrap break-words text-sm text-cloistr-light">
        {segments.map((segment, i) => (
          <SegmentView key={i} segment={segment} profiles={profiles} inline />
        ))}
      </p>

      {!compact && <Media segments={segments} />}
    </div>
  );
}

function SegmentView({
  segment,
  profiles,
  inline,
}: {
  segment: Segment;
  profiles: Map<string, { name?: string; displayName?: string }>;
  inline: boolean;
}) {
  switch (segment.type) {
    case 'text':
      return <>{segment.value}</>;

    case 'link':
      return (
        <a
          href={segment.href}
          target="_blank"
          // noopener: without it the opened page gets a handle on ours via
          // window.opener and can navigate it somewhere else.
          rel="noopener noreferrer nofollow"
          className="text-cloistr-primary hover:underline"
        >
          {segment.label}
        </a>
      );

    case 'hashtag':
      return (
        <Link to={`/t/${encodeURIComponent(segment.tag)}`} className="text-cloistr-primary hover:underline">
          #{segment.tag}
        </Link>
      );

    case 'entity':
      return <EntityView id={segment.id} profiles={profiles} />;

    // Media is pulled out below the text rather than rendered mid-sentence, so
    // it does not break the flow of a paragraph.
    case 'image':
    case 'video':
      return inline ? null : <></>;

    default:
      return null;
  }
}

function EntityView({
  id,
  profiles,
}: {
  id: string;
  profiles: Map<string, { name?: string; displayName?: string }>;
}) {
  let decoded: ReturnType<typeof decodeIdentifier>;
  try {
    decoded = decodeIdentifier(id);
  } catch {
    // decodeIdentifier throws for an nsec. Someone pasting their key into a
    // NOTE has already published it, so there is nothing to protect here --
    // but we must not render it as a link, and must not crash the feed.
    return <span className="text-cloistr-error">[private key redacted]</span>;
  }

  if (decoded?.type === 'profile') {
    const p = profiles.get(decoded.pubkey);
    const name = p?.displayName || p?.name || abbreviate(id, 10);
    return (
      <Link to={profilePath(decoded.pubkey, decoded.relays)} className="text-cloistr-primary hover:underline">
        @{name}
      </Link>
    );
  }

  if (decoded?.type === 'event') {
    return (
      <Link
        to={notePath(decoded.id, decoded.relays, decoded.author)}
        className="text-cloistr-primary hover:underline"
      >
        {abbreviate(id, 10)}
      </Link>
    );
  }

  // An naddr or something we do not route yet stays as text rather than
  // becoming a link to nowhere.
  return <span className="text-cloistr-light/60">{abbreviate(id, 10)}</span>;
}

function Media({ segments }: { segments: Segment[] }) {
  const images = segments.filter((s) => s.type === 'image');
  const videos = segments.filter((s) => s.type === 'video');

  if (images.length === 0 && videos.length === 0) return null;

  return (
    <div className={`grid gap-2 ${images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {images.map((s) => s.type === 'image' && <RemoteImage key={s.src} src={s.src} />)}
      {videos.map(
        (s) =>
          s.type === 'video' && (
            <video
              key={s.src}
              src={s.src}
              controls
              preload="metadata"
              className="max-h-96 w-full rounded-lg bg-black"
            />
          )
      )}
    </div>
  );
}

function RemoteImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);

  // A dead image host is ordinary -- one turned up in the operator's own
  // console tonight -- and a broken-image glyph with no explanation reads as
  // our bug. Say what happened and leave the URL reachable.
  if (failed) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="block rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-3 text-xs text-cloistr-light/50 hover:text-cloistr-light/80"
      >
        Image could not be loaded — open it directly
      </a>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      // referrerPolicy: an image host should not learn which note the viewer is
      // reading. It cannot be stopped from seeing the IP, but the referrer is
      // free to withhold.
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="max-h-96 w-full rounded-lg object-cover"
    />
  );
}
