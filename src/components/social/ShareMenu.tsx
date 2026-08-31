/**
 * @fileoverview Share a post, in the two forms people actually need.
 *
 * The button was inert with "Sharing is not implemented". The blocker was real
 * -- there was nothing to share a link TO -- and it is gone now that NIP-19
 * identifiers and the /e/:id route exist.
 *
 * TWO OPTIONS, NOT ONE, because there is no single string that works
 * everywhere and picking one silently would be wrong half the time:
 *
 *   A WEB LINK opens in a browser and lands on our page. Paste it into Damus
 *   and you get a URL that client cannot resolve.
 *
 *   A NOSTR ID (nevent) is what every Nostr client understands. Paste it into a
 *   browser and nothing happens.
 *
 * Both carry relay hints from the user's own relays, because a bare id is
 * unresolvable for anyone not already connected to a relay that holds the
 * event -- which, for us, is nearly everyone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNdk, encodeEvent, notePath } from '@/services/nostr';

interface Props {
  noteId: string;
  authorPubkey: string;
}

/**
 * Relay hints for a share link: the user's OWN relays only.
 *
 * Not every relay the outbox model happened to discover. A hint pointing at a
 * stranger's relay is noise at best, and if that relay drops the event it is a
 * link that quietly stops working for whoever we gave it to.
 *
 * Connected-ness is deliberately NOT a filter. A configured relay that is
 * momentarily down is still where this event lives, and omitting it would make
 * the quality of a shared link depend on the sharer's connection at the instant
 * they pressed the button.
 */
export function ownRelayHints(statuses: Map<string, { url: string; configured: boolean }>): string[] {
  return Array.from(statuses.values())
    .filter((s) => s.configured)
    .map((s) => s.url);
}

/** Where a shared web link points. */
const ORIGIN = typeof window !== 'undefined' ? window.location.origin : 'https://space.cloistr.xyz';

export function ShareMenu({ noteId, authorPubkey }: Props) {
  const { relayStatuses } = useNdk();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const hints = useMemo(() => ownRelayHints(relayStatuses), [relayStatuses]);

  const nevent = useMemo(
    () => encodeEvent(noteId, hints, authorPubkey),
    [noteId, hints, authorPubkey]
  );
  const webLink = `${ORIGIN}${notePath(noteId, hints, authorPubkey)}`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const copy = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      // Say it worked. A copy button that does nothing visible is
      // indistinguishable from one that failed.
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied('failed');
      setTimeout(() => setCopied(null), 3000);
    }
    setOpen(false);
  }, []);

  const nativeShare = useCallback(async () => {
    try {
      await navigator.share({ url: webLink });
    } catch {
      // Includes the user simply dismissing the sheet, which is not an error
      // and must not be reported as one.
    }
    setOpen(false);
  }, [webLink]);

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Share this post"
        className="text-cloistr-light/40 hover:text-cloistr-primary"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
      </button>

      {copied && (
        <span
          role="status"
          className="absolute bottom-full right-0 mb-1 whitespace-nowrap rounded bg-cloistr-dark px-2 py-1 text-xs text-cloistr-light/80"
        >
          {copied === 'failed' ? 'Could not copy' : `${copied} copied`}
        </span>
      )}

      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-20 mb-2 w-56 rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-1 shadow-lg"
        >
          <MenuItem onClick={() => void copy(webLink, 'Link')} label="Copy link" hint="Opens in a browser" />
          <MenuItem
            onClick={() => void copy(nevent, 'Nostr ID')}
            label="Copy Nostr ID"
            hint="Paste into any Nostr client"
          />
          {canNativeShare && <MenuItem onClick={() => void nativeShare()} label="Share…" hint="System share sheet" />}
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, label, hint }: { onClick: () => void; label: string; hint: string }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="block w-full rounded px-2 py-1.5 text-left hover:bg-cloistr-light/10"
    >
      <span className="block text-sm text-cloistr-light">{label}</span>
      <span className="block text-xs text-cloistr-light/40">{hint}</span>
    </button>
  );
}
