/**
 * @fileoverview Manage the operator's own kind:10030 emoji list.
 *
 * Reachable from the reaction picker's "Customize" entry (ReactionPicker.tsx).
 * There is no app-wide Settings page in this codebase yet (checked: only
 * GroupSettings.tsx exists, and that is per-project), so the picker is
 * currently the only entry point -- add a second one here if a Settings view
 * is ever built.
 *
 * SAME PRIVACY RULE AS THE PICKER: custom entries are shown as `:shortcode:`
 * text ONLY. This component never renders an <img> for a custom entry's url --
 * doing so here would be the exact third-party-egress hole emojiSets.ts and
 * third-party-egress.md section 2 exist to close, just moved to a different
 * component instead of closed.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isRenderable } from '@/services/social/emojiSets';
import { useEmojiListEditor } from '@/services/social/useEmojiListEditor';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function EmojiListEditor({ isOpen, onClose }: Props) {
  const {
    entries,
    isLoading,
    loadFailed,
    isBusy,
    error,
    notice,
    reload,
    addUnicode,
    addCustom,
    remove,
    moveUp,
    moveDown,
    dismiss,
  } = useEmojiListEditor();

  const [nativeInput, setNativeInput] = useState('');
  const [nativeShortcode, setNativeShortcode] = useState('');
  const [customShortcode, setCustomShortcode] = useState('');
  const [customUrl, setCustomUrl] = useState('');

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const submitUnicode = async (e: FormEvent) => {
    e.preventDefault();
    await addUnicode(nativeInput, nativeShortcode);
    setNativeInput('');
    setNativeShortcode('');
  };

  const submitCustom = async (e: FormEvent) => {
    e.preventDefault();
    await addCustom(customShortcode, customUrl);
    setCustomShortcode('');
    setCustomUrl('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Customize your reaction emoji"
        className="my-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-cloistr-light">Your reaction emoji</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-cloistr-light/50 hover:text-cloistr-light"
          >
            &times;
          </button>
        </div>

        {(error || notice) && (
          <div
            role={error ? 'alert' : 'status'}
            className={`mb-3 flex items-start justify-between gap-2 rounded px-3 py-2 text-sm ${
              error
                ? 'bg-cloistr-error/10 text-cloistr-error'
                : 'bg-cloistr-primary/10 text-cloistr-primary'
            }`}
          >
            <span>{error ?? notice}</span>
            <button type="button" onClick={dismiss} className="shrink-0 opacity-70 hover:opacity-100">
              &times;
            </button>
          </div>
        )}

        {isLoading && <p className="text-sm text-cloistr-light/40">Loading your list…</p>}

        {!isLoading && loadFailed && (
          <div className="mb-3 rounded bg-cloistr-error/10 px-3 py-2 text-sm text-cloistr-error">
            Could not load your current list.
            <button type="button" onClick={reload} className="ml-2 underline">
              Try again
            </button>
          </div>
        )}

        {!isLoading && !loadFailed && (
          <ul className="mb-4 divide-y divide-cloistr-light/10" aria-label="Your emoji">
            {entries.length === 0 && (
              <li className="py-2 text-sm text-cloistr-light/40">
                You have no emoji of your own yet. Add one below.
              </li>
            )}
            {entries.map((entry, index) => (
              <li key={entry.shortcode} className="flex items-center gap-2 py-2">
                <span className="w-8 text-center text-lg" aria-hidden={!isRenderable(entry)}>
                  {isRenderable(entry) ? entry.native : null}
                </span>
                <span className="flex-1 truncate text-sm text-cloistr-light/80">
                  :{entry.shortcode}:
                  {!isRenderable(entry) && (
                    <span className="ml-1 text-xs text-cloistr-light/40">(custom, image not loaded)</span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={isBusy || index === 0}
                  onClick={() => moveUp(entry.shortcode)}
                  aria-label={`Move :${entry.shortcode}: up`}
                  className="rounded px-1.5 py-0.5 text-cloistr-light/60 hover:bg-cloistr-light/10 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={isBusy || index === entries.length - 1}
                  onClick={() => moveDown(entry.shortcode)}
                  aria-label={`Move :${entry.shortcode}: down`}
                  className="rounded px-1.5 py-0.5 text-cloistr-light/60 hover:bg-cloistr-light/10 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => remove(entry.shortcode)}
                  aria-label={`Remove :${entry.shortcode}:`}
                  className="rounded px-1.5 py-0.5 text-cloistr-error/70 hover:bg-cloistr-error/10 disabled:opacity-30"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submitUnicode} className="mb-3 flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-cloistr-light/50" htmlFor="emoji-native-input">
              Emoji character
            </label>
            <input
              id="emoji-native-input"
              type="text"
              value={nativeInput}
              onChange={(e) => setNativeInput(e.target.value)}
              placeholder="🔥"
              maxLength={16}
              disabled={isBusy}
              className="w-full rounded border border-cloistr-light/20 bg-cloistr-dark px-2 py-1.5 text-sm text-cloistr-light"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-cloistr-light/50" htmlFor="emoji-native-shortcode">
              Shortcode
            </label>
            <input
              id="emoji-native-shortcode"
              type="text"
              value={nativeShortcode}
              onChange={(e) => setNativeShortcode(e.target.value)}
              placeholder="fire"
              disabled={isBusy}
              className="w-full rounded border border-cloistr-light/20 bg-cloistr-dark px-2 py-1.5 text-sm text-cloistr-light"
            />
          </div>
          <button
            type="submit"
            disabled={isBusy || !nativeInput.trim() || !nativeShortcode.trim()}
            className="rounded bg-cloistr-primary px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Add
          </button>
        </form>

        <form onSubmit={submitCustom} className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-cloistr-light/50" htmlFor="emoji-custom-shortcode">
              Shortcode
            </label>
            <input
              id="emoji-custom-shortcode"
              type="text"
              value={customShortcode}
              onChange={(e) => setCustomShortcode(e.target.value)}
              placeholder="party"
              disabled={isBusy}
              className="w-full rounded border border-cloistr-light/20 bg-cloistr-dark px-2 py-1.5 text-sm text-cloistr-light"
            />
          </div>
          <div className="flex-[2]">
            <label className="mb-1 block text-xs text-cloistr-light/50" htmlFor="emoji-custom-url">
              Image URL (https://)
            </label>
            <input
              id="emoji-custom-url"
              type="text"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://example.com/party.png"
              disabled={isBusy}
              className="w-full rounded border border-cloistr-light/20 bg-cloistr-dark px-2 py-1.5 text-sm text-cloistr-light"
            />
          </div>
          <button
            type="submit"
            disabled={isBusy || !customShortcode.trim() || !customUrl.trim()}
            className="rounded bg-cloistr-primary px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Add
          </button>
        </form>

        {/* Never an <img>. Custom entries show as :shortcode: text only --
            see the file docblock. */}
        <p className="mt-3 text-[11px] text-cloistr-light/30">
          Custom emoji show as text here. Images are never fetched from
          third-party hosts.
        </p>
      </div>
    </div>
  );
}
