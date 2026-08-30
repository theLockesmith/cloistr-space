/**
 * @fileoverview Pick a reaction emoji.
 *
 * Opened by holding, right-clicking, or ArrowDown on the reaction button --
 * see useLongPressMenu. A plain click never reaches here; it still sends the
 * default heart, unchanged.
 *
 * Custom (image-backed) emoji are listed as their `:shortcode:` text and their
 * images are NOT loaded. That is deliberate and explained in emojiSets.ts: a
 * NIP-51 set is a list of URLs on hosts strangers chose, and rendering them
 * would disclose the user's IP -- and the moment they opened a reaction picker
 * -- to every one of those hosts. Picking one still publishes correctly.
 */

import { useEffect, useRef } from 'react';
import { isRenderable, type EmojiEntry } from '@/services/social/emojiSets';

interface Props {
  emoji: EmojiEntry[];
  isLoading: boolean;
  onPick: (entry: EmojiEntry) => void;
  onClose: () => void;
}

export function ReactionPicker({ emoji, isLoading, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on Escape or on a click elsewhere. Both, because either alone leaves
  // a way to get stuck with the menu open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };

    document.addEventListener('keydown', onKey);
    // Capture phase: the reaction button stops propagation on its own click,
    // so a bubble-phase listener would never see a second press on it.
    document.addEventListener('mousedown', onDown, true);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [onClose]);

  useEffect(() => {
    // Move focus in so keyboard users are not left behind on the trigger.
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [emoji.length]);

  const unicode = emoji.filter(isRenderable);
  const custom = emoji.filter((e) => !isRenderable(e));

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Pick a reaction"
      className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-2 shadow-lg"
    >
      <div className="grid grid-cols-6 gap-1">
        {unicode.map((entry) => (
          <button
            key={entry.shortcode}
            role="menuitem"
            title={`:${entry.shortcode}:`}
            aria-label={entry.shortcode}
            onClick={() => onPick(entry)}
            className="flex h-9 w-9 items-center justify-center rounded text-lg hover:bg-cloistr-light/10"
          >
            {entry.native}
          </button>
        ))}
      </div>

      {custom.length > 0 && (
        <div className="mt-2 border-t border-cloistr-light/10 pt-2">
          {/* Named rather than shown. Saying why keeps this from reading as a
              rendering bug to anyone who knows their set has pictures in it. */}
          <p className="mb-1 px-1 text-[11px] text-cloistr-light/40">
            From your emoji sets. Images are not loaded, to avoid contacting
            third-party hosts.
          </p>
          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
            {custom.map((entry) => (
              <button
                key={entry.shortcode}
                role="menuitem"
                onClick={() => onPick(entry)}
                className="rounded bg-cloistr-light/5 px-1.5 py-0.5 text-xs text-cloistr-light/70 hover:bg-cloistr-light/10"
              >
                :{entry.shortcode}:
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading && unicode.length === 0 && (
        <p className="px-1 py-2 text-xs text-cloistr-light/40">Loading your emoji…</p>
      )}
    </div>
  );
}
