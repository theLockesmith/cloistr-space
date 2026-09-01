/**
 * @fileoverview Hook for group ownership: resolve the current owner and
 * provide the owner-only transfer action.
 *
 * Ownership is derived from the d-tag, not from event timestamps. See
 * ownership.ts for the full reasoning. This hook fetches all kind:39000 events
 * for the group's d-tag, passes them with the identifier to resolveOwnership(),
 * and presents the result to the UI.
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
  /**
   * Resolved ownership. Two states:
   *   { status: 'owner'; ownerPubkey; fromTransfer } — chain resolved.
   *   { status: 'legacy' } — identifier predates pubkey-aware scheme;
   *     ownership unverifiable. NOT a fallback to earliest-wins.
   * Null while loading.
   */
  ownership: OwnershipResolution | null;
  isLoading: boolean;
  /**
   * True when the signed-in user is the current owner.
   * Fails CLOSED while loading or for legacy groups — owner-gated controls
   * are hidden rather than offered and then refused.
   */
  isOwner: boolean;
  /**
   * Transfer ownership to another pubkey. Owner-only.
   *
   * Re-reads the chain before publishing. A stale or unconfirmed ownership
   * check produces no publish — same discipline as readAdmins.
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

      // groupId IS the d-tag (identifier). Pass it to resolveOwnership so the
      // pubkey prefix can be extracted without a separate query.
      setOwnership(resolveOwnership(groupId, Array.from(events)));
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

  // Fails CLOSED: false while loading, for legacy groups, and on error.
  const isOwner =
    !isLoading &&
    !!pubkey &&
    ownership?.status === 'owner' &&
    ownership.ownerPubkey === pubkey;

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
        // Re-read the full chain before publishing. A stale `isOwner` value is
        // possible if the chain changed elsewhere since this hook last ran.
        // Same reasoning as readAdmins: a failed or changed read must not
        // become a publish.
        const events = await fetchEvents({
          kinds: [GROUP_METADATA_KIND as number],
          '#d': [groupId],
        });

        const allEvents = Array.from(events);
        const current = resolveOwnership(groupId, allEvents);

        if (current.status !== 'owner' || current.ownerPubkey !== pubkey) {
          setNotice(
            'Your ownership could not be confirmed from the group identifier. Nothing was changed.'
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
          'Ownership transferred. This client, and any client that checks the group identifier, will recognise the new owner.'
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
