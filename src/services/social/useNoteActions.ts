/**
 * @fileoverview Note actions hook
 * React, reply, repost notes
 */

import { useCallback } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { REACTION_KIND, REPOST_KIND } from '@/types/social';

/**
 * Why an action cannot run right now, or null when it can.
 *
 * Four separate values rather than one "unavailable", because they are four
 * different problems with four different remedies -- and because a single
 * boolean is what made this bug take a round trip to the user to locate. The
 * button rendered identically whichever of these was true, so "you are signed
 * out" and "the app is broken" looked the same from the outside.
 */
export type ActionBlockedReason =
  | 'not-signed-in'
  | 'no-identity'
  | 'not-connected'
  | 'signer-unavailable';

/** Human-readable, and short enough to sit under a row of buttons on a phone. */
export const ACTION_BLOCKED_MESSAGE: Record<ActionBlockedReason, string> = {
  'not-signed-in': 'Sign in to react, repost or reply.',
  'no-identity': 'Your session has no public key yet — try reloading.',
  'not-connected': 'Not connected to any relay, so nothing can be published.',
  'signer-unavailable': 'Still starting up — actions will work in a moment.',
};

/**
 * Which precondition blocks an action, or null when none does.
 *
 * Pure and exported so it can be tested directly. The ORDER is the part worth
 * pinning: it decides which of several simultaneous problems the user is told
 * about, and the most actionable one should win -- signing in is something they
 * can do, waiting for a service to start is not.
 */
export function actionBlockedReason(state: {
  isAuthenticated: boolean;
  pubkey: string | null;
  publish: unknown;
  isConnected: boolean;
}): ActionBlockedReason | null {
  if (!state.isAuthenticated) return 'not-signed-in';
  // Authenticated with no pubkey is a real state, not a contradiction: the SSO
  // bridge sets the flag and the key through separate paths, so one can land
  // without the other. It is also the case a single boolean would have hidden.
  if (!state.pubkey) return 'no-identity';
  if (!state.publish) return 'signer-unavailable';
  if (!state.isConnected) return 'not-connected';
  return null;
}

interface UseNoteActionsReturn {
  /** React to a note with + or emoji */
  react: (eventId: string, pubkey: string, content?: string) => Promise<void>;
  /** Repost a note */
  repost: (eventId: string, pubkey: string, relay?: string) => Promise<void>;
  /** Whether connected and can act */
  canAct: boolean;
  /**
   * Which precondition failed, or null when canAct is true.
   *
   * Exposed so the UI can say WHICH, rather than silently doing nothing. A
   * control that cannot act and does not say so is indistinguishable from one
   * that is broken.
   */
  blockedReason: ActionBlockedReason | null;
}

/**
 * Hook for note interactions
 */
export function useNoteActions(): UseNoteActionsReturn {
  const { publish, createEvent, isConnected } = useNdk();
  const { pubkey, isAuthenticated } = useAuthStore();

  const blockedReason = actionBlockedReason({
    isAuthenticated,
    pubkey,
    publish,
    isConnected,
  });

  const canAct = blockedReason === null;

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
    blockedReason,
  };
}
