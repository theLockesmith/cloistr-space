/**
 * @fileoverview React state for the emoji list editor UI.
 *
 * Thin glue over emojiListService.ts: supplies NDK-backed signer/relay via
 * useHeadlessAdapters (the same adapters useGroupAdmin uses), loads the
 * operator's current direct entries for display, and turns each pure
 * EditResult into either a displayed list update or an error string.
 *
 * Loading is its own concern, separate from editing: `loadFailed` is true
 * only when the INITIAL read could not be completed, so the UI can say "could
 * not load your list" rather than quietly showing an empty one that looks
 * identical to "you have no emoji yet."
 */

import { useCallback, useEffect, useState } from 'react';
import { useHeadlessAdapters } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { parseDirectEmoji, type EmojiEntry } from './emojiSets';
import {
  readEmojiList,
  addUnicodeEmoji,
  addCustomEmoji,
  removeEmojiEntry,
  moveEmojiEntry,
  REFUSAL_MESSAGE,
  type EditResult,
} from './emojiListService';

interface UseEmojiListEditorReturn {
  entries: EmojiEntry[];
  isLoading: boolean;
  /** True only when the initial read itself failed -- not "list is empty." */
  loadFailed: boolean;
  isBusy: boolean;
  error: string | null;
  notice: string | null;
  reload: () => void;
  addUnicode: (native: string, shortcode: string) => Promise<void>;
  addCustom: (shortcode: string, url: string) => Promise<void>;
  remove: (shortcode: string) => Promise<void>;
  moveUp: (shortcode: string) => Promise<void>;
  moveDown: (shortcode: string) => Promise<void>;
  dismiss: () => void;
}

export function useEmojiListEditor(): UseEmojiListEditorReturn {
  const { signer, relay } = useHeadlessAdapters();
  const { pubkey } = useAuthStore();

  const [entries, setEntries] = useState<EmojiEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Promise-chained rather than async/await: every setState call here must
  // run from inside a .then()/.finally() callback, not synchronously in
  // load's own body -- react-hooks/set-state-in-effect flags the latter even
  // behind an await, since the effect below calls this function directly and,
  // statically, that is indistinguishable from an unconditional
  // render-triggering update. See useGroupOwner.ts for the same pattern.
  const load = useCallback(() => {
    if (!relay || !pubkey) return Promise.resolve();

    return Promise.resolve()
      .then(() => setIsLoading(true))
      .then(() => readEmojiList(relay, pubkey))
      .then((read) => {
        if (!read.ok) {
          setLoadFailed(true);
          return;
        }
        setLoadFailed(false);
        setEntries(parseDirectEmoji(read.tags));
      })
      .finally(() => setIsLoading(false));
  }, [relay, pubkey]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (op: () => Promise<EditResult>) => {
      setIsBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await op();
        if (!result.ok) {
          setError(REFUSAL_MESSAGE[result.reason]);
          return;
        }
        setEntries(parseDirectEmoji(result.tags));
        setNotice('Saved.');
      } catch (e) {
        // Read failures and "zero relays accepted" both arrive here as a
        // thrown Error from emojiListService -- see its docblock for why a
        // failed read throws rather than returning a refusal.
        setError(e instanceof Error ? e.message : 'The change was not saved.');
      } finally {
        setIsBusy(false);
      }
    },
    [],
  );

  const addUnicode = useCallback(
    async (native: string, shortcode: string) => {
      if (!signer || !relay) { setError('Not connected.'); return; }
      await run(() => addUnicodeEmoji(signer, relay, native, shortcode));
    },
    [signer, relay, run],
  );

  const addCustom = useCallback(
    async (shortcode: string, url: string) => {
      if (!signer || !relay) { setError('Not connected.'); return; }
      await run(() => addCustomEmoji(signer, relay, shortcode, url));
    },
    [signer, relay, run],
  );

  const remove = useCallback(
    async (shortcode: string) => {
      if (!signer || !relay) { setError('Not connected.'); return; }
      await run(() => removeEmojiEntry(signer, relay, shortcode));
    },
    [signer, relay, run],
  );

  const moveUp = useCallback(
    async (shortcode: string) => {
      if (!signer || !relay) { setError('Not connected.'); return; }
      await run(() => moveEmojiEntry(signer, relay, shortcode, 'up'));
    },
    [signer, relay, run],
  );

  const moveDown = useCallback(
    async (shortcode: string) => {
      if (!signer || !relay) { setError('Not connected.'); return; }
      await run(() => moveEmojiEntry(signer, relay, shortcode, 'down'));
    },
    [signer, relay, run],
  );

  return {
    entries,
    isLoading,
    loadFailed,
    isBusy,
    error,
    notice,
    reload: load,
    addUnicode,
    addCustom,
    remove,
    moveUp,
    moveDown,
    dismiss: useCallback(() => {
      setError(null);
      setNotice(null);
    }, []),
  };
}
