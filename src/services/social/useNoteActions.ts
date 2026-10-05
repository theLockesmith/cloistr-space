/**
 * @fileoverview Note actions hook
 * React, reply, repost notes. Event building lives in noteService.ts, which a
 * headless caller can use directly.
 */

import { useCallback } from 'react';
import { useNdk, useHeadlessAdapters } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { PublishOutcome } from '../headless';
import { reactToNote, replyToNote, retractEvent, repostNote } from './noteService';

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

export type { PublishOutcome } from '../headless';

interface UseNoteActionsReturn {
  /** React to a note with + or emoji. Throws when no relay accepts it. */
  react: (
    eventId: string,
    pubkey: string,
    content?: string,
    extraTags?: string[][]
  ) => Promise<PublishOutcome>;
  /**
   * Publish a kind:1 reply.
   *
   * Tags are built by the CALLER (replyEvents.buildReplyTags) rather than here,
   * because placing a reply in a thread needs the root as well as the parent,
   * and only the thread view knows both.
   */
  reply: (content: string, tags: string[][]) => Promise<PublishOutcome>;
  /**
   * Retract an event you published, via NIP-09 kind:5.
   *
   * Used to un-heart and un-repost. A deletion request is a REQUEST: relays are
   * not obliged to honour it and other clients may keep showing the event. That
   * is the protocol's shape, not a bug in this call, and the UI should not
   * promise more than it can deliver.
   */
  undo: (eventId: string) => Promise<PublishOutcome>;
  /** Repost a note. Throws when no relay accepts it. */
  repost: (eventId: string, pubkey: string, relay?: string) => Promise<PublishOutcome>;
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
  const { publish, isConnected } = useNdk();
  const { signer, relay } = useHeadlessAdapters();
  const { pubkey, isAuthenticated } = useAuthStore();

  const blockedReason = actionBlockedReason({
    isAuthenticated,
    pubkey,
    publish,
    isConnected,
  });

  const canAct = blockedReason === null;

  const react = useCallback(
    async (eventId: string, eventPubkey: string, content = '+', extraTags: string[][] = []) => {
      if (!signer || !relay) throw new Error('Not connected');
      return reactToNote(signer, relay, eventId, eventPubkey, content, extraTags);
    },
    [signer, relay]
  );

  const reply = useCallback(
    async (content: string, tags: string[][]) => {
      if (!signer || !relay) throw new Error('Not connected');
      return replyToNote(signer, relay, content, tags);
    },
    [signer, relay]
  );

  const undo = useCallback(
    async (eventId: string) => {
      if (!signer || !relay) throw new Error('Not connected');
      return retractEvent(signer, relay, eventId);
    },
    [signer, relay]
  );

  const repost = useCallback(
    async (eventId: string, eventPubkey: string, relayHint?: string) => {
      if (!signer || !relay) throw new Error('Not connected');
      return repostNote(signer, relay, eventId, eventPubkey, relayHint);
    },
    [signer, relay]
  );

  return {
    react,
    reply,
    undo,
    repost,
    canAct,
    blockedReason,
  };
}
