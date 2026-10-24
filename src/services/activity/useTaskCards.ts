/**
 * @fileoverview The Tasks widget's data: the user's open cards from the Tasks
 * API (see taskCards.ts). The request is signed, which for a remote signer is
 * an approval, so a successful read is kept for a few minutes rather than
 * re-signed on every Activity visit; refresh always asks again. A refusal or
 * a failed request is an error, never "No tasks yet".
 */

import { useCallback, useEffect, useState } from 'react';
import { useHeadlessAdapters } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { fetchAssignedCards, type TaskCard } from './taskCards';

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

export function useTaskCards({ limit = 5 }: { limit?: number } = {}): TaskCardsState & { refresh: () => void } {
  const { signer } = useHeadlessAdapters();
  const { pubkey } = useAuthStore();
  const [state, setState] = useState<TaskCardsState>({ items: [], isLoading: true, error: null });
  const [run, setRun] = useState(0);
  const [force, setForce] = useState(false);

  useEffect(() => {
    if (!pubkey || !signer) return;
    let cancelled = false;
    const start = setTimeout(() => {
      const kept = reuse.get(pubkey);
      if (!force && kept && Date.now() - kept.at < TASK_CARDS_REUSE_MS) {
        setState({ items: kept.cards.slice(0, limit), isLoading: false, error: null });
        return;
      }
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      fetchAssignedCards(signer).then(
        (cards) => {
          reuse.set(pubkey, { at: Date.now(), cards });
          if (!cancelled) setState({ items: cards.slice(0, limit), isLoading: false, error: null });
        },
        (err) => {
          if (!cancelled)
            setState({ items: [], isLoading: false, error: err instanceof Error ? err.message : String(err) });
        }
      );
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [pubkey, signer, limit, run, force]);

  const refresh = useCallback(() => {
    setForce(true);
    setRun((n) => n + 1);
  }, []);

  return { ...state, refresh };
}
