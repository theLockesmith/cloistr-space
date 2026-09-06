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
 *
 * THE READS FILTER BY AUTHOR. Because a publish rewrites the whole list, a
 * read that swallowed an attacker's self-published kind:39002 would republish
 * it signed by the owner. That is the one path that turns a forgeable event
 * into a trusted one, so the author check belongs here even more than on the
 * display path. See trustedWriters.ts.
 */

import { useCallback, useState } from 'react';
import { useNdk } from '@/services/nostr';
import {
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  GROUP_METADATA_KIND,
  type AdminPermission,
} from '@/types/groups';
import { buildAdminTags } from './permissions';
import { resolveTrustedWriters, authoritativeMembers } from './trustedWriters';
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
  /** Replace one person's permissions, keeping everyone else's. */
  setPermissions: (pubkey: string, permissions: AdminPermission[]) => Promise<void>;
  removeMember: (pubkey: string) => Promise<void>;
  updateMetadata: (edit: GroupMetadataEdit) => Promise<void>;
  isBusy: boolean;
  error: string | null;
  notice: string | null;
  dismiss: () => void;
}

export function useGroupAdmin(groupId: string): UseGroupAdminReturn {
  const { fetchFromOwnRelays, createEvent, publish, isConnected } = useNdk();

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
    if (!fetchFromOwnRelays || !isConnected) return { ok: false, members: [] };

    try {
      // Metadata and admins come along because the trusted-writer check needs
      // them. THIS READ IS THE BASE FOR THE NEXT PUBLISH, which is why the
      // author filter matters more here than on the display path: reading an
      // attacker's kind:39002 and republishing it under the owner's key turns
      // an injection anyone could ignore into one signed by the owner.
      const events = await fetchFromOwnRelays({
        kinds: [GROUP_METADATA_KIND as number, GROUP_ADMINS_KIND as number, GROUP_MEMBERS_KIND as number],
        '#d': [groupId],
      });

      const all = Array.from(events);
      const writers = resolveTrustedWriters(groupId, all);

      if (writers.status === 'resolved') {
        // [] here means "no member event from a trusted writer", which is a
        // legitimately empty group. null never comes back for a resolved
        // group; the ?? is for the type, not for a case that occurs.
        return { ok: true, members: authoritativeMembers(writers, all) ?? [] };
      }

      // Legacy identifier: no owner anchor exists, so there is nothing to
      // filter by. Behaviour is unchanged for these groups rather than
      // refused, because every group that exists today is one of them and
      // refusing would remove the only way to manage them. useGroupMembers
      // marks them unverifiable in the UI. The fix is a migration to
      // pubkey-aware identifiers, not a check we cannot perform.
      const latest = all
        .filter((e) => e.kind === GROUP_MEMBERS_KIND)
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];

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
  }, [fetchFromOwnRelays, isConnected, groupId]);

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

  /**
   * Read the current kind:39001, reporting WHETHER THE READ WORKED separately.
   *
   * Same shape and same reason as readMembers: kind:39001 is addressable, so a
   * replacement carrying one person's permissions REMOVES everyone else's. A
   * failed read must not become a publish.
   */
  const readAdmins = useCallback(async (): Promise<{
    ok: boolean;
    entries: { pubkey: string; permissions: AdminPermission[] }[];
  }> => {
    if (!fetchFromOwnRelays || !isConnected) return { ok: false, entries: [] };

    try {
      const events = await fetchFromOwnRelays({
        kinds: [GROUP_METADATA_KIND as number, GROUP_ADMINS_KIND as number],
        '#d': [groupId],
      });

      const all = Array.from(events);
      const writers = resolveTrustedWriters(groupId, all);

      // Resolved groups take the owner-signed list only. An attacker's
      // kind:39001 naming themselves an admin is not in it.
      if (writers.status === 'resolved') return { ok: true, entries: writers.admins };

      // Legacy identifier: unchanged, for the reason given in readMembers.
      const latest = all
        .filter((e) => e.kind === GROUP_ADMINS_KIND)
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];

      // No event is a legitimate "nobody has permissions yet", not a failure.
      if (!latest) return { ok: true, entries: [] };

      return {
        ok: true,
        entries: latest.tags
          .filter((t) => t[0] === 'p' && t[1])
          .map((t) => ({ pubkey: t[1], permissions: t.slice(2) as AdminPermission[] })),
      };
    } catch {
      return { ok: false, entries: [] };
    }
  }, [fetchFromOwnRelays, isConnected, groupId]);

  /**
   * Set one person's permissions, preserving everyone else's.
   *
   * Read, replace that one entry, publish the WHOLE list. The caller checks
   * permissionEditRefusal first; this checks the read, because a UI guard and a
   * service guard fail differently and only the second survives a refactor.
   */
  const setPermissions = useCallback(
    async (pubkey: string, permissions: AdminPermission[]) => {
      if (!createEvent || !publish) {
        setError('Not connected');
        return;
      }

      setIsBusy(true);
      setError(null);
      setNotice(null);

      try {
        const read = await readAdmins();
        if (!read.ok) {
          setNotice(
            'Could not read the current permissions, so nothing was changed. Publishing now would have removed everyone else\'s.'
          );
          return;
        }

        const others = read.entries.filter((e) => e.pubkey !== pubkey);
        const next = [...others, { pubkey, permissions }];

        const event = createEvent();
        if (!event) throw new Error('Failed to make event');

        event.kind = GROUP_ADMINS_KIND as number;
        event.content = '';
        event.tags = buildAdminTags(groupId, next);

        const accepted = await publish(event);
        if (accepted.size === 0) throw new Error('No relay accepted the change.');

        setNotice('Permissions updated.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The change was not saved.');
      } finally {
        setIsBusy(false);
      }
    },
    [createEvent, publish, groupId, readAdmins]
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
        // REFUSE A NAMELESS SAVE, even though the UI already blocks it.
        //
        // kind:39000 is addressable: publishing without a name tag REMOVES the
        // project's name. The settings form guards this by not rendering until
        // the project loads, but a guard that lives only in a component is one
        // refactor away from being gone, and the cost of being wrong here is
        // the name of somebody's project.
        //
        // Same family as the emptiness guard in publishContacts and the
        // full-list read in membersAfterAdd.
        if (!edit.name?.trim()) {
          setNotice('A project needs a name. Nothing was changed.');
          setIsBusy(false);
          return;
        }

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
    setPermissions,
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
