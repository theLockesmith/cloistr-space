/**
 * @fileoverview Actions on your own post. Currently: delete it.
 *
 * A user could not retract anything they had posted. That is a trust problem
 * rather than a missing feature -- "you cannot take it back" is a property
 * people reasonably assume is false, and discovering otherwise after posting
 * something they regret is the worst moment to learn it.
 *
 * SHOWN ONLY ON YOUR OWN POSTS. A delete control on someone else's note would
 * be an inert lie: NIP-09 only retracts events you signed, so relays would
 * ignore it and other clients would show the note unchanged.
 *
 * TWO-STEP RATHER THAN window.confirm. The browser dialog is unstyled, blocks
 * the page, and reads as a crash on mobile. More to the point, the second step
 * can say what deletion actually MEANS here, which a yes/no box cannot.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  onDelete: () => void;
  isBusy: boolean;
}

export function OwnNoteMenu({ onDelete, isBusy }: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setConfirming(false);
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const confirm = useCallback(() => {
    setOpen(false);
    setConfirming(false);
    onDelete();
  }, [onDelete]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Post options"
        className="px-1 text-cloistr-light/40 hover:text-cloistr-light"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-20 mb-2 w-64 rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-2 shadow-lg"
        >
          {confirming ? (
            <div className="space-y-2">
              {/* What deletion actually means. A kind:5 is a REQUEST: relays
                  may ignore it and other clients may keep showing the post.
                  Promising more than that would be a lie the protocol makes
                  impossible to keep. */}
              <p className="text-xs text-cloistr-light/70">
                This asks relays to delete the post. Most will honour it, but copies may
                remain on relays or clients we cannot reach.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={confirm}
                  disabled={isBusy}
                  className="rounded bg-cloistr-error px-3 py-1.5 text-xs text-white disabled:opacity-50"
                >
                  {isBusy ? 'Deleting…' : 'Delete anyway'}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="rounded px-3 py-1.5 text-xs text-cloistr-light/60"
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button
              role="menuitem"
              onClick={() => setConfirming(true)}
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-cloistr-light/10"
            >
              <span className="block text-sm text-cloistr-error">Delete post</span>
              <span className="block text-xs text-cloistr-light/40">Asks relays to remove it</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
