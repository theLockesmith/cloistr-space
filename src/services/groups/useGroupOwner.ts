/**
 * @fileoverview Hook for group ownership: resolve the current owner and
 * provide the owner-only transfer action.
 *
 * Ownership is DERIVED from the event record, not declared. See ownership.ts
 * for the full reasoning. This hook fetches all kind:39000 events for the
 * group's d-tag, walks the transfer chain, and presents the result to the UI.
 *
 * SAME READ-BEFORE-PUBLISH DISCIPLINE as readMembers and readAdmins in
 * useGroupAdmin. A transfer publishes a kind:39000, which is addressable and
 * replaces its predecessor wholesale. A stale or failed read must not become
 * a publish that wipes the group's name.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { GROUP_METADATA_KIND } from '@/types/groups';
import {
  resolveOwnership,
  buildTransferTags,
  type OwnershipResolution,
} from './ownership';

export type { OwnershipResolution };

export interface UseGroupOwnerReturn {
  /** Resolved ownership, or null while loading or if no kind:39000 exists. */
  ownership: OwnershipResolution | null;
  isLoading: boolean;
  /**
   * True when the signed-in user is the current owner.
   *
   * Fails CLOSED while loading: the controls this gates are hidden until the
   * check completes rather than offered and then refused.
   */
  isOwner: boolean;
  /**
   * Transfer ownership to another pubkey. Owner-only.
   *
   * Publishes a kind:39000 from the current owner carrying the transfer-to
   * tag and the existing group metadata. A failed or unconfirmed ownership
   * re-read produces no publish.
   */
  transferOwnership: (successorPubkey: string) => Promise<void>;
  isBusy: boolean;
  error: string | null;
  notice: string | null;
  dismiss: () => void;
}

export function useGroupOwner(groupId: string): UseGroupOwnerReturn {
  const { fetchEvents, createEvent, publish, isConnected } = useNdk();
  const { pubkey } = useAuthStore();

  const [ownership, setOwnership] = useState<OwnershipResolution | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOwnership = useCallback(async () => {
    if (!fetchEvents || !isConnected) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const events = await fetchEvents({
        kinds: [GROUP_METADATA_KIND as number],
        '#d': [groupId],
      });

      setOwnership(resolveOwnership(Array.from(events)));
    } catch {
      // Unknown owner is not fatal. isOwner fails closed (false), so nothing
      // owner-gated is offered, which is the safe state.
    } finally {
      setIsLoading(false);
    }
  }, [fetchEvents, isConnected, groupId]);

  useEffect(() => {
    void loadOwnership();
  }, [loadOwnership]);

  // Fails CLOSED while loading or on error.
  const isOwner = !isLoading && !!pubkey && ownership?.ownerPubkey === pubkey;

  const transferOwnership = useCallback(
    async (successorPubkey: string) => {
      if (!fetchEvents || !createEvent || !publish) {
        setError('Not connected');
        return;
      }

      setIsBusy(true);
      setError(null);
      setNotice(null);

      try {
        // Re-read the full chain before publishing. A stale `isOwner` value
        // is possible if the chain was updated elsewhere since this hook last
        // ran. The same reasoning as readAdmins: a failed or changed read must
        // not become a publish.
        const events = await fetchEvents({
          kinds: [GROUP_METADATA_KIND as number],
          '#d': [groupId],
        });

        const allEvents = Array.from(events);
        const current = resolveOwnership(allEvents);

        if (!current || current.ownerPubkey !== pubkey) {
          setNotice(
            'Your ownership could not be confirmed from the creation event. Nothing was changed.'
          );
          return;
        }

        // Preserve the current group metadata alongside the transfer so the
        // name is not wiped. kind:39000 is addressable and replaces wholesale —
        // a transfer event with no name tag removes the group's name.
        const myEvents = allEvents
          .filter((e) => e.pubkey === pubkey)
          .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));

        const myLatest = myEvents[0];
        const metadata = {
          name: myLatest?.tags.find((t) => t[0] === 'name')?.[1],
          about: myLatest?.tags.find((t) => t[0] === 'about')?.[1],
          picture: myLatest?.tags.find((t) => t[0] === 'picture')?.[1],
        };

        const event = createEvent();
        if (!event) throw new Error('Failed to make event');

        event.kind = GROUP_METADATA_KIND as number;
        event.content = '';
        event.tags = buildTransferTags(groupId, successorPubkey, metadata);

        const accepted = await publish(event);
        if (accepted.size === 0) throw new Error('No relay accepted the transfer.');

        setNotice(
          'Ownership transferred. This client, and any client that checks the creation event, will recognise the new owner.'
        );
        await loadOwnership();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The transfer was not saved.');
      } finally {
        setIsBusy(false);
      }
    },
    [fetchEvents, createEvent, publish, groupId, pubkey, loadOwnership]
  );

  return {
    ownership,
    isLoading,
    isOwner,
    transferOwnership,
    isBusy,
    error,
    notice,
    dismiss: useCallback(() => {
      setError(null);
      setNotice(null);
    }, []),
  };
}
