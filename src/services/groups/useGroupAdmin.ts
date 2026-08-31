/**
 * @fileoverview Add and remove members, and edit group metadata.
 *
 * CLIENT-AUTHORITATIVE, because our relay does not run relay29. Nothing
 * processes a kind:9000 here, so the key holder publishes kind:39002 directly
 * and it is a plain addressable event. See membershipEdits.ts for the full
 * reasoning and for the hazard that follows from it.
 *
 * Every mutation is READ, COMPUTE, PUBLISH-WHOLE, and a read that failed
 * produces no publish. The read is done fresh at edit time rather than reusing
 * whatever the member list component last rendered -- that list may be minutes
 * old, and publishing a stale full list would silently revert somebody else's
 * change.
 */

import { useCallback, useState } from 'react';
import { useNdk } from '@/services/nostr';
import { GROUP_MEMBERS_KIND, GROUP_METADATA_KIND } from '@/types/groups';
import {
  membersAfterAdd,
  membersAfterRemove,
  buildMemberTags,
  REFUSAL_MESSAGE,
  type MemberRead,
} from './membershipEdits';

export interface GroupMetadataEdit {
  name?: string;
  about?: string;
  picture?: string;
}

interface UseGroupAdminReturn {
  addMember: (pubkey: string) => Promise<void>;
  removeMember: (pubkey: string) => Promise<void>;
  updateMetadata: (edit: GroupMetadataEdit) => Promise<void>;
  isBusy: boolean;
  error: string | null;
  notice: string | null;
  dismiss: () => void;
}

export function useGroupAdmin(groupId: string): UseGroupAdminReturn {
  const { fetchEvents, createEvent, publish, isConnected } = useNdk();

  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Read the current member list, reporting WHETHER THE READ WORKED separately
   * from what it found.
   *
   * `ok: false` on a throw is the whole safety property. Returning an empty
   * array on failure would be indistinguishable from a group with no members,
   * and the caller would then publish a list that removes everyone.
   */
  const readMembers = useCallback(async (): Promise<MemberRead> => {
    if (!fetchEvents || !isConnected) return { ok: false, members: [] };

    try {
      const events = await fetchEvents({
        kinds: [GROUP_MEMBERS_KIND as number],
        '#d': [groupId],
      });

      const latest = Array.from(events).sort(
        (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)
      )[0];

      // No event at all is a legitimate empty group, not a failure -- a group
      // that has never had a member list published has none.
      if (!latest) return { ok: true, members: [] };

      return {
        ok: true,
        members: latest.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]),
      };
    } catch {
      return { ok: false, members: [] };
    }
  }, [fetchEvents, isConnected, groupId]);

  const publishMembers = useCallback(
    async (members: string[]) => {
      if (!createEvent || !publish) throw new Error('Not connected');

      const event = createEvent();
      if (!event) throw new Error('Failed to make event');

      event.kind = GROUP_MEMBERS_KIND as number;
      event.content = '';
      event.tags = buildMemberTags(groupId, members);

      const accepted = await publish(event);
      if (accepted.size === 0) throw new Error('No relay accepted the change.');
    },
    [createEvent, publish, groupId]
  );

  const runEdit = useCallback(
    async (compute: (read: MemberRead) => ReturnType<typeof membersAfterAdd>, done: string) => {
      setIsBusy(true);
      setError(null);
      setNotice(null);

      try {
        const read = await readMembers();
        const result = compute(read);

        if (!result.ok) {
          // A refusal is not an error, and saying WHY matters more here than
          // anywhere else in the app -- "nothing happened" after pressing
          // Remove is how someone concludes the feature is broken and tries
          // again until it works.
          setNotice(REFUSAL_MESSAGE[result.reason]);
          return;
        }

        await publishMembers(result.members);
        setNotice(done);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The change was not saved.');
      } finally {
        setIsBusy(false);
      }
    },
    [readMembers, publishMembers]
  );

  const addMember = useCallback(
    (pubkey: string) => runEdit((read) => membersAfterAdd(read, pubkey), 'Member added.'),
    [runEdit]
  );

  const removeMember = useCallback(
    (pubkey: string) => runEdit((read) => membersAfterRemove(read, pubkey), 'Member removed.'),
    [runEdit]
  );

  /**
   * Edit group metadata.
   *
   * kind:39000 is addressable too, so the same wholesale-replacement hazard
   * applies -- but the blast radius is a name and a description rather than the
   * membership, and there is no read we could do that makes a partial edit
   * safer. Fields left undefined are simply not written.
   */
  const updateMetadata = useCallback(
    async (edit: GroupMetadataEdit) => {
      if (!createEvent || !publish) {
        setError('Not connected');
        return;
      }

      setIsBusy(true);
      setError(null);
      setNotice(null);

      try {
        const event = createEvent();
        if (!event) throw new Error('Failed to make event');

        const tags: string[][] = [['d', groupId]];
        if (edit.name?.trim()) tags.push(['name', edit.name.trim()]);
        if (edit.about?.trim()) tags.push(['about', edit.about.trim()]);
        if (edit.picture?.trim()) tags.push(['picture', edit.picture.trim()]);

        event.kind = GROUP_METADATA_KIND as number;
        event.content = '';
        event.tags = tags;

        const accepted = await publish(event);
        if (accepted.size === 0) throw new Error('No relay accepted the change.');

        setNotice('Project details saved.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The change was not saved.');
      } finally {
        setIsBusy(false);
      }
    },
    [createEvent, publish, groupId]
  );

  return {
    addMember,
    removeMember,
    updateMetadata,
    isBusy,
    error,
    notice,
    dismiss: useCallback(() => {
      setError(null);
      setNotice(null);
    }, []),
  };
}
