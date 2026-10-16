/**
 * @fileoverview The Tasks widget's data: the user's open cards from the Tasks
 * API (see taskCards.ts). The request is signed, which for a remote signer is
 * an approval, so a successful read is kept for a few minutes rather than
 * re-signed on every Activity visit; refresh always asks again. A refusal or
 * a failed request is an error, never "No tasks yet".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useHeadlessAdapters } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { fetchAssignedCards, type TaskCard } from './taskCards';
import { useUnreachable } from './widgetReads';

/** How long a successful read is reused before signing again. */
export const TASK_CARDS_REUSE_MS = 5 * 60_000;

const reuse = new Map<string, { at: number; cards: TaskCard[] }>();

/** Forget kept reads (logout, tests). */
export function clearTaskCardsCache(): void {
  reuse.clear();
}

interface TaskCardsState {
  items: TaskCard[];
  isLoading: boolean;
  error: string | null;
}

/** Shown when no signer appears, so the request cannot be signed. */
export const TASKS_SIGNER_NOT_READY =
  'Could not read your tasks: your signer is not connected. Try again once it is.';

export function useTaskCards({ limit = 5 }: { limit?: number } = {}): TaskCardsState & { refresh: () => void } {
  const { signer } = useHeadlessAdapters();
  const { pubkey } = useAuthStore();
  // `owner` is the key the cards were read for. On a key switch the previous
  // key's cards stay in state until the new read answers, so they are filtered
  // out at render: one account must never see another's cards.
  const [state, setState] = useState<TaskCardsState & { owner: string | null }>({
    items: [],
    isLoading: true,
    error: null,
    owner: null,
  });
  const [run, setRun] = useState(0);
  // One-shot: only the read a refresh started skips the reuse window. As state
  // it stayed true for the life of the widget, so every later re-run signed again.
  const forceRef = useRef(false);
  // A signer that never appears is an error, not an endless skeleton.
  const signerMissing = useUnreachable(!!signer);

  useEffect(() => {
    if (!pubkey || !signer) return;
    let cancelled = false;
    const start = setTimeout(() => {
      const force = forceRef.current;
      forceRef.current = false;
      const kept = reuse.get(pubkey);
      if (!force && kept && Date.now() - kept.at < TASK_CARDS_REUSE_MS) {
        setState({ items: kept.cards.slice(0, limit), isLoading: false, error: null, owner: pubkey });
        return;
      }
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      fetchAssignedCards(signer).then(
        (cards) => {
          reuse.set(pubkey, { at: Date.now(), cards });
          if (!cancelled) setState({ items: cards.slice(0, limit), isLoading: false, error: null, owner: pubkey });
        },
        (err) => {
          if (!cancelled)
            setState({
              items: [],
              isLoading: false,
              error: err instanceof Error ? err.message : String(err),
              owner: pubkey,
            });
        }
      );
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [pubkey, signer, limit, run]);

  const refresh = useCallback(() => {
    forceRef.current = true;
    setRun((n) => n + 1);
  }, []);

  if (pubkey && !signer) {
    return signerMissing
      ? { items: [], isLoading: false, error: TASKS_SIGNER_NOT_READY, refresh }
      : { items: [], isLoading: true, error: null, refresh };
  }
  if (state.owner !== pubkey) return { items: [], isLoading: true, error: null, refresh };
  return { items: state.items, isLoading: state.isLoading, error: state.error, refresh };
}
