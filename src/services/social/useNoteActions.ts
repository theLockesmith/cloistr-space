/**
 * @fileoverview Note actions hook
 * React, reply, repost notes
 */

import { useCallback } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { REACTION_KIND, REPOST_KIND } from '@/types/social';

interface UseNoteActionsReturn {
  /** React to a note with + or emoji */
  react: (eventId: string, pubkey: string, content?: string) => Promise<void>;
  /** Repost a note */
  repost: (eventId: string, pubkey: string, relay?: string) => Promise<void>;
  /** Whether connected and can act */
  canAct: boolean;
}

/**
 * Hook for note interactions
 */
export function useNoteActions(): UseNoteActionsReturn {
  const { publish, createEvent, isConnected } = useNdk();
  const { pubkey, isAuthenticated } = useAuthStore();

  const canAct = Boolean(publish && isConnected && isAuthenticated && pubkey);

  // React to a note (kind:7)
  const react = useCallback(
    async (eventId: string, eventPubkey: string, content = '+') => {
      if (!publish || !createEvent || !pubkey) {
        throw new Error('Not connected');
      }

      const event = createEvent();
      if (!event) throw new Error('Failed to make event');

      event.kind = REACTION_KIND;
      event.content = content;
      event.tags = [
        ['e', eventId],
        ['p', eventPubkey],
      ];

      await publish(event);
    },
    [publish, createEvent, pubkey]
  );

  // Repost a note (kind:6)
  const repost = useCallback(
    async (eventId: string, eventPubkey: string, relay?: string) => {
      if (!publish || !createEvent || !pubkey) {
        throw new Error('Not connected');
      }

      const event = createEvent();
      if (!event) throw new Error('Failed to make event');

      event.kind = REPOST_KIND;
      event.content = '';
      event.tags = [
        ['e', eventId, relay ?? '', 'mention'],
        ['p', eventPubkey],
      ];

      await publish(event);
    },
    [publish, createEvent, pubkey]
  );

  return {
    react,
    repost,
    canAct,
  };
}
