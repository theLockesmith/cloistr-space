/**
 * @fileoverview Follow and unfollow, with the failure made visible.
 *
 * The contact list is a NIP-0A kind:33000 CRDT, so following is two steps: a
 * local store mutation, then a publish. Either can fail, and the earlier
 * reaction bug taught us what happens when only the first one is shown -- the
 * button changes, nothing reaches a relay, and the user believes they followed
 * someone they did not.
 *
 * So the optimistic update is REVERTED VISIBLY when the publish fails, and the
 * reason is surfaced rather than logged.
 */

import { useCallback, useState } from 'react';
import { useContactsStore } from '@/stores/contactsStore';
import { useContactsSync } from '@/services/crdt/useContactsSync';
import { useAuthStore } from '@/stores/authStore';

export type FollowBlockedReason = 'not-signed-in' | 'self' | 'not-ready';

export const FOLLOW_BLOCKED_MESSAGE: Record<FollowBlockedReason, string> = {
  'not-signed-in': 'Sign in to follow people.',
  self: 'This is you.',
  'not-ready': 'Not connected to a relay yet.',
};

/**
 * Why following is unavailable, or null when it is available.
 *
 * Pure so it can be tested without a relay. Order matters: "this is you" is
 * more useful than "not connected" when both are true, because one is a
 * permanent fact about the page and the other is transient.
 */
export function followBlockedReason(
  viewerPubkey: string | null,
  targetPubkey: string,
  isReady: boolean
): FollowBlockedReason | null {
  if (!viewerPubkey) return 'not-signed-in';
  if (viewerPubkey === targetPubkey) return 'self';
  if (!isReady) return 'not-ready';
  return null;
}

interface UseFollowReturn {
  isFollowing: boolean;
  /** True while a publish is in flight. */
  isBusy: boolean;
  /** Why the control is unavailable, or null. */
  blockedReason: FollowBlockedReason | null;
  error: string | null;
  toggle: () => Promise<void>;
  dismissError: () => void;
}

export function useFollow(targetPubkey: string): UseFollowReturn {
  const { pubkey } = useAuthStore();
  const { contacts, addContact, removeContact } = useContactsStore();
  const { sync, isReady } = useContactsSync();

  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFollowing = contacts.get(targetPubkey)?.isFollowing ?? false;
  const blockedReason = followBlockedReason(pubkey, targetPubkey, isReady);

  const toggle = useCallback(async () => {
    if (blockedReason !== null || isBusy) return;

    const wasFollowing = isFollowing;
    setError(null);
    setIsBusy(true);

    // Optimistic: the store drives the button, so this shows immediately.
    if (wasFollowing) removeContact(targetPubkey);
    else addContact(targetPubkey);

    try {
      const result = await sync();
      if (!result.success) {
        throw new Error(result.error ?? 'The relay did not accept the change.');
      }
    } catch (e) {
      // Put it back, visibly. A button left in the new state after a failed
      // publish claims something that did not happen.
      if (wasFollowing) addContact(targetPubkey);
      else removeContact(targetPubkey);

      setError(
        e instanceof Error
          ? `${wasFollowing ? 'Unfollow' : 'Follow'} not saved. ${e.message}`
          : `${wasFollowing ? 'Unfollow' : 'Follow'} not saved.`
      );
    } finally {
      setIsBusy(false);
    }
  }, [blockedReason, isBusy, isFollowing, targetPubkey, addContact, removeContact, sync]);

  return {
    isFollowing,
    isBusy,
    blockedReason,
    error,
    toggle,
    dismissError: useCallback(() => setError(null), []),
  };
}
