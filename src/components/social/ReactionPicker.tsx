/**
 * @fileoverview Pick a reaction emoji.
 *
 * Opened by holding, right-clicking, or ArrowDown on the reaction button --
 * see useLongPressMenu. A plain click never reaches here; it still sends the
 * default heart, unchanged.
 *
 * Custom emoji images are served through the blossom mirror at
 * files.cloistr.xyz rather than loaded from the origin hosts named in NIP-51
 * sets. Loading images directly from those hosts would disclose the viewer's
 * IP -- and the moment they opened a reaction picker -- to whoever published
 * the set. The mirror fetches server-side; the client never contacts the origin.
 *
 * Three distinguishable failure states are shown when a mirror result is not
 * available. Collapsing them into one would hide information useful for
 * debugging.
 */

import { useEffect, useRef } from 'react';
import { isRenderable, type EmojiEntry } from '@/services/social/emojiSets';
import type { MirrorMap } from '@/services/cloistr/useMirrorSign';

interface Props {
  emoji: EmojiEntry[];
  isLoading: boolean;
  mirrorMap: MirrorMap;
  isMirroring: boolean;
  onPick: (entry: EmojiEntry) => void;
  onClose: () => void;
}

export function ReactionPicker({
  emoji,
  isLoading,
  mirrorMap,
  isMirroring,
  onPick,
  onClose,
}: Props) {
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

  // Partition custom emoji by mirror state.
  const mirrored = custom.filter(
    (e) => e.url && mirrorMap.get(e.url)?.state === 'ok'
  );
  const refused = custom.filter(
    (e) => e.url && mirrorMap.get(e.url)?.state === 'refused'
  );
  const unreachable = custom.filter(
    (e) => e.url && mirrorMap.get(e.url)?.state === 'unreachable'
  );
  const pending = custom.filter(
    (e) => e.url && !mirrorMap.has(e.url)
  );
  // disabled: entire mirror is off — handled below by checking any entry.
  const mirrorDisabled = custom.some(
    (e) => e.url && mirrorMap.get(e.url)?.state === 'disabled'
  );

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Pick a reaction"
      className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-2 shadow-lg"
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
          {/* Images that resolved successfully through the mirror. */}
          {mirrored.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {mirrored.map((entry) => {
                const result = mirrorMap.get(entry.url!);
                const src = result?.state === 'ok' ? result.url : undefined;
                return (
                  <button
                    key={entry.shortcode}
                    role="menuitem"
                    title={`:${entry.shortcode}:`}
                    aria-label={entry.shortcode}
                    onClick={() => onPick(entry)}
                    className="flex h-9 w-9 items-center justify-center rounded hover:bg-cloistr-light/10"
                  >
                    {src ? (
                      <img
                        src={src}
                        alt={`:${entry.shortcode}:`}
                        className="h-7 w-7 rounded object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-xs text-cloistr-light/60">
                        :{entry.shortcode}:
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Entries still waiting for a mirror link. */}
          {pending.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {pending.map((entry) => (
                <button
                  key={entry.shortcode}
                  role="menuitem"
                  onClick={() => onPick(entry)}
                  title={isMirroring ? 'Loading image…' : `:${entry.shortcode}:`}
                  className="rounded bg-cloistr-light/5 px-1.5 py-0.5 text-xs text-cloistr-light/50 hover:bg-cloistr-light/10"
                >
                  :{entry.shortcode}:
                </button>
              ))}
            </div>
          )}

          {/* Permanent refusals — the mirror fetched and said no. */}
          {refused.length > 0 && (
            <>
              <p className="mb-1 px-1 text-[11px] text-cloistr-light/30">
                Not available (image refused by mirror):
              </p>
              <div className="mb-1 flex flex-wrap gap-1">
                {refused.map((entry) => (
                  <button
                    key={entry.shortcode}
                    role="menuitem"
                    onClick={() => onPick(entry)}
                    title="This image was refused by the mirror and cannot be shown"
                    className="rounded bg-cloistr-light/5 px-1.5 py-0.5 text-xs text-cloistr-light/30 line-through hover:bg-cloistr-light/10"
                  >
                    :{entry.shortcode}:
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Transient unreachable — the remote host did not answer. */}
          {unreachable.length > 0 && (
            <>
              <p className="mb-1 px-1 text-[11px] text-cloistr-light/40">
                Image unavailable (host unreachable — try again later):
              </p>
              <div className="mb-1 flex flex-wrap gap-1">
                {unreachable.map((entry) => (
                  <button
                    key={entry.shortcode}
                    role="menuitem"
                    onClick={() => onPick(entry)}
                    title="The remote host did not answer. Try opening the picker again later."
                    className="rounded bg-cloistr-light/5 px-1.5 py-0.5 text-xs text-amber-400/60 hover:bg-cloistr-light/10"
                  >
                    :{entry.shortcode}:
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Mirror feature is off on this server. */}
          {mirrorDisabled && (
            <p className="px-1 text-[11px] text-cloistr-light/30">
              From your emoji sets. Images are not loaded, to avoid contacting
              third-party hosts.
            </p>
          )}

          {/* Still signing — only show if nothing has resolved yet. */}
          {isMirroring && mirrored.length === 0 && !mirrorDisabled && (
            <p className="px-1 text-[11px] text-cloistr-light/40">
              Loading emoji images…
            </p>
          )}
        </div>
      )}

      {isLoading && unicode.length === 0 && (
        <p className="px-1 py-2 text-xs text-cloistr-light/40">Loading your emoji…</p>
      )}
    </div>
  );
}
