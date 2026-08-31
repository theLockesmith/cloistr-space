/**
 * @fileoverview Note actions hook
 * React, reply, repost notes
 */

import { useCallback } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { DELETE_KIND, NOTE_KIND, REACTION_KIND, REPOST_KIND } from '@/types/social';

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

/**
 * How a publish went.
 *
 * The user's relay list is mostly third-party, so "some relays took it" is the
 * normal good outcome and must not read as failure. Only zero acceptances is an
 * actual failure, and that is what throws.
 */
export interface PublishOutcome {
  /** Relays that accepted the event. Never zero -- zero throws instead. */
  acceptedBy: number;
  /**
   * The id of the event we just published.
   *
   * Needed so a reaction or repost can be UNDONE without waiting for the relay
   * echo to come back and tell us what we just sent. Undo is a NIP-09 kind:5
   * referencing this id, and a user who taps a heart and immediately taps it
   * again should not have to wait on a round trip to change their mind.
   */
  eventId: string;
}

/**
 * Turn NDK's relay set into a success or a throw.
 *
 * event.publish() resolves with the relays that ACCEPTED, and does not reject
 * when some refuse -- so a silent partial failure and a total failure are the
 * same value shape. Zero acceptances is the only real failure; anything above
 * zero means the event is on the network somewhere.
 *
 * This matters here specifically because relay.cloistr.xyz gates writes behind
 * PoW, NIP-42 auth and a whitelist, so it can refuse an event that eleven other
 * relays take without complaint.
 */
function publishOrThrow(relays: Set<unknown>, eventId: string): PublishOutcome {
  if (relays.size === 0) {
    throw new Error('No relay accepted it. Check your relay list and connection.');
  }
  return { acceptedBy: relays.size, eventId };
}

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
    async (
      eventId: string,
      eventPubkey: string,
      content = '+',
      extraTags: string[][] = []
    ): Promise<PublishOutcome> => {
      if (!publish || !createEvent || !pubkey) {
        throw new Error('Not connected');
      }

      const event = createEvent();
      if (!event) throw new Error('Failed to make event');

      event.kind = REACTION_KIND;
      event.content = content;
      // extraTags carries the NIP-25 `["emoji", shortcode, url]` for a custom
      // reaction. We never load that image ourselves, but the receiving client
      // needs the tag to render what the user actually picked -- so declining
      // to fetch must not become declining to publish.
      event.tags = [
        ['e', eventId],
        ['p', eventPubkey],
        ...extraTags,
      ];

      const accepted = await publish(event);
      return publishOrThrow(accepted, event.id);
    },
    [publish, createEvent, pubkey]
  );

  // Reply to a note (kind:1, NIP-10 markers supplied by the caller)
  const reply = useCallback(
    async (content: string, tags: string[][]): Promise<PublishOutcome> => {
      if (!publish || !createEvent || !pubkey) {
        throw new Error('Not connected');
      }
      if (!content.trim()) {
        throw new Error('A reply needs some text');
      }

      const event = createEvent();
      if (!event) throw new Error('Failed to make event');

      event.kind = NOTE_KIND;
      event.content = content.trim();
      event.tags = tags;

      const accepted = await publish(event);
      return publishOrThrow(accepted, event.id);
    },
    [publish, createEvent, pubkey]
  );

  // Retract one of our own events (kind:5, NIP-09)
  const undo = useCallback(
    async (eventId: string): Promise<PublishOutcome> => {
      if (!publish || !createEvent || !pubkey) {
        throw new Error('Not connected');
      }

      const event = createEvent();
      if (!event) throw new Error('Failed to make event');

      event.kind = DELETE_KIND;
      event.content = '';
      event.tags = [['e', eventId]];

      const accepted = await publish(event);
      return publishOrThrow(accepted, event.id);
    },
    [publish, createEvent, pubkey]
  );

  // Repost a note (kind:6)
  const repost = useCallback(
    async (eventId: string, eventPubkey: string, relay?: string): Promise<PublishOutcome> => {
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

      const accepted = await publish(event);
      return publishOrThrow(accepted, event.id);
    },
    [publish, createEvent, pubkey]
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
