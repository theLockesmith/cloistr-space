/**
 * @fileoverview Three ways into the same menu: hold, right-click, keyboard.
 *
 * The operator asked for BOTH desktop affordances rather than either: right-
 * click for people who expect a context menu, and press-and-hold with a mouse
 * for people carrying the mobile gesture across. Press-and-hold is genuinely
 * undiscoverable with a mouse -- which is why right-click is the primary -- but
 * honouring it costs nothing for someone who tries it.
 *
 * Two things here are easy to get wrong and both produce a bug that only shows
 * up under real fingers:
 *
 *  1. A fired hold MUST swallow the click that follows it. Otherwise one
 *     gesture opens the picker AND sends the default reaction, so the user gets
 *     a heart they did not ask for behind a menu they did.
 *
 *  2. preventDefault on contextmenu belongs to THIS control only. Swallowing
 *     the context menu across the note or the feed would break copy and
 *     open-in-new-tab on post text, which is a worse papercut than the one
 *     being avoided.
 */

import { useCallback, useEffect, useRef } from 'react';

/** Long enough not to fire while tapping, short enough not to feel stuck. */
const DEFAULT_HOLD_MS = 500;

interface Options {
  /** Open the menu. */
  onOpen: () => void;
  /** The plain click action. */
  onActivate: () => void;
  disabled?: boolean;
  holdMs?: number;
}

export function useLongPressMenu({
  onOpen,
  onActivate,
  disabled = false,
  holdMs = DEFAULT_HOLD_MS,
}: Options) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when a hold completes, read and cleared by the click that follows.
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Right-click has its own path; starting a hold timer here too would open
      // the menu twice for one gesture.
      if (disabled || e.button !== 0) return;

      firedRef.current = false;
      clear();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        onOpen();
      }, holdMs);
    },
    [disabled, clear, holdMs, onOpen]
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      // Scoped to this control. See the header.
      e.preventDefault();
      clear();
      // A right-click can arrive after a pointerdown, so make sure the click
      // that may follow is not treated as a plain activation.
      firedRef.current = true;
      onOpen();
    },
    [disabled, clear, onOpen]
  );

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      clear();
      if (firedRef.current) {
        // The hold already did the work. Consume this so it does not also
        // send the default reaction.
        firedRef.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (disabled) return;
      onActivate();
    },
    [disabled, clear, onActivate]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      // ArrowDown is the usual keyboard route into a menu button. The
      // ContextMenu key needs no handling -- browsers dispatch `contextmenu`
      // for it, so it arrives above for free.
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onOpen();
      }
    },
    [disabled, onOpen]
  );

  return {
    /** Spread onto the control. */
    handlers: {
      onPointerDown,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu,
      onClick,
      onKeyDown,
    },
  };
}
