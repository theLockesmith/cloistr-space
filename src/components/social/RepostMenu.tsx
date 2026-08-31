/**
 * @fileoverview Repost, quote, or undo — as visible choices.
 *
 * WHY A MENU ON CLICK rather than a hold or right-click accelerator. The
 * reaction picker hides behind a hold because plain tap has an obvious default
 * (a heart) and the picker is a refinement. Repost has no such default: "repost
 * this" and "repost this with my comment" are different acts, and the operator
 * has already demonstrated this morning what happens to a capability that lives
 * only behind a right-click -- they went looking for one, did not find it, and
 * reported the FEATURE as missing.
 *
 * Undo lives here too, which is better than the alternative of tapping an
 * active repost and hoping. "Undo repost" says what it will do.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  isReposted: boolean;
  canAct: boolean;
  count: number;
  /**
   * Repost or retract, depending on current state.
   *
   * ONE handler, not two, because the caller's handler already dispatches on
   * `userReposted` -- it has to, since the undo path needs the id of our own
   * kind:6. Passing the same function as both onRepost and onUndo would work
   * and would read as a mistake to anyone maintaining this.
   */
  onToggle: () => void;
  onQuote: () => void;
}

export function RepostMenu({ isReposted, canAct, count, onToggle, onQuote }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const pick = useCallback((action: () => void) => {
    setOpen(false);
    action();
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={!canAct}
        aria-disabled={!canAct}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={isReposted ? 'Reposted — repost options' : 'Repost options'}
        className={`flex items-center gap-2 text-sm ${
          !canAct
            ? 'cursor-not-allowed text-cloistr-light/20'
            : isReposted
              ? 'text-cloistr-success'
              : 'text-cloistr-light/40 hover:text-cloistr-success'
        }`}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {count > 0 && count}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-2 w-48 rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-1 shadow-lg"
        >
          {isReposted ? (
            <MenuItem
              label="Undo repost"
              hint="Asks relays to drop it"
              onClick={() => pick(onToggle)}
            />
          ) : (
            <MenuItem label="Repost" hint="Share as-is" onClick={() => pick(onToggle)} />
          )}
          <MenuItem
            label="Quote post"
            hint="Add your own comment"
            onClick={() => pick(onQuote)}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
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
