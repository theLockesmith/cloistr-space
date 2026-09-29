/**
 * Pure group operations, callable without React.
 *
 * Each function accepts a NostrClient (the headless abstraction over
 * signer + relay). The React hooks in useGroupActions and useGroupAdmin
 * delegate here; a headless caller provides its own NostrClient.
 */

import type { NostrClient, NostrEventLike } from '../headless';
import type { AdminPermission } from '@/types/groups';
import {
  GROUP_METADATA_KIND,
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  GROUP_JOIN_REQUEST_KIND,
  GROUP_LEAVE_REQUEST_KIND,
} from '@/types/groups';
import { buildGroupIdentifier } from './ownership';
import { buildAdminTags } from './permissions';
import { resolveTrustedWriters, authoritativeMembers } from './trustedWriters';
import {
  membersAfterAdd,
  membersAfterRemove,
  buildMemberTags,
  type MemberRead,
  type EditRefusal,
} from './membershipEdits';

export interface CreateGroupOptions {
  name: string;
  description?: string;
  picture?: string;
  isPublic?: boolean;
  isOpen?: boolean;
}

export interface GroupMetadataEdit {
  name?: string;
  about?: string;
  picture?: string;
}

export async function joinGroup(
  client: NostrClient,
  groupId: string,
  message?: string,
): Promise<void> {
  await client.signAndPublish({
    kind: GROUP_JOIN_REQUEST_KIND,
    content: message || '',
    tags: [['h', groupId]],
  });
}

export async function leaveGroup(
  client: NostrClient,
  groupId: string,
): Promise<void> {
  await client.signAndPublish({
    kind: GROUP_LEAVE_REQUEST_KIND,
    content: '',
    tags: [['h', groupId]],
  });
}

export async function createGroup(
  client: NostrClient,
  options: CreateGroupOptions,
): Promise<string> {
  const pubkey = await client.getPublicKey();
  const { name, description, picture, isPublic = true, isOpen = false } = options;
  const identifier = buildGroupIdentifier(name, pubkey);

  const metadataTags: string[][] = [
    ['d', identifier],
    ['name', name],
  ];
  if (description) metadataTags.push(['about', description]);
  if (picture) metadataTags.push(['picture', picture]);
  metadataTags.push([isPublic ? 'public' : 'private']);
  metadataTags.push([isOpen ? 'open' : 'closed']);

  await client.signAndPublish({
    kind: GROUP_METADATA_KIND,
    content: description || '',
    tags: metadataTags,
  });

  await client.signAndPublish({
    kind: GROUP_ADMINS_KIND,
    content: '',
    tags: [
      ['d', identifier],
      ['p', pubkey, 'add-user', 'remove-user', 'edit-metadata', 'delete-event', 'add-permission', 'remove-permission'],
    ],
  });

  await client.signAndPublish({
    kind: GROUP_MEMBERS_KIND,
    content: '',
    tags: [
      ['d', identifier],
      ['p', pubkey],
    ],
  });

  return identifier;
}

// --- Read operations ---

export async function readGroupMembers(
  client: NostrClient,
  groupId: string,
): Promise<MemberRead> {
  try {
    const events = await client.fetch({
      kinds: [GROUP_METADATA_KIND, GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND],
      '#d': [groupId],
    });

    // Safe cast: resolveTrustedWriters only reads kind, pubkey, tags,
    // created_at, id — all present on NostrEventLike. The NDKEvent type
    // is a packaging artifact, not a runtime dependency.
    const writers = resolveTrustedWriters(groupId, events as any);

    if (writers.status === 'resolved') {
      return { ok: true, members: authoritativeMembers(writers, events as any) ?? [] };
    }

    const latest = events
      .filter((e) => e.kind === GROUP_MEMBERS_KIND)
      .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];

    if (!latest) return { ok: true, members: [] };

    return {
      ok: true,
      members: latest.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]),
    };
  } catch {
    return { ok: false, members: [] };
  }
}

export async function addGroupMember(
  client: NostrClient,
  groupId: string,
  pubkey: string,
): Promise<{ ok: true } | { ok: false; reason: EditRefusal }> {
  const read = await readGroupMembers(client, groupId);
  const result = membersAfterAdd(read, pubkey);
  if (!result.ok) return result;

  const count = await client.signAndPublish({
    kind: GROUP_MEMBERS_KIND,
    content: '',
    tags: buildMemberTags(groupId, result.members),
  });
  if (count === 0) throw new Error('No relay accepted the change.');
  return { ok: true };
}

export async function removeGroupMember(
  client: NostrClient,
  groupId: string,
  pubkey: string,
): Promise<{ ok: true } | { ok: false; reason: EditRefusal }> {
  const read = await readGroupMembers(client, groupId);
  const result = membersAfterRemove(read, pubkey);
  if (!result.ok) return result;

  const count = await client.signAndPublish({
    kind: GROUP_MEMBERS_KIND,
    content: '',
    tags: buildMemberTags(groupId, result.members),
  });
  if (count === 0) throw new Error('No relay accepted the change.');
  return { ok: true };
}

export async function readGroupAdmins(
  client: NostrClient,
  groupId: string,
): Promise<{
  ok: boolean;
  entries: { pubkey: string; permissions: AdminPermission[] }[];
  ownerPubkey?: string;
}> {
  try {
    const events = await client.fetch({
      kinds: [GROUP_METADATA_KIND, GROUP_ADMINS_KIND],
      '#d': [groupId],
    });

    const writers = resolveTrustedWriters(groupId, events as any);

    if (writers.status === 'resolved') {
      return { ok: true, entries: writers.admins, ownerPubkey: writers.owner };
    }

    const latest = events
      .filter((e: NostrEventLike) => e.kind === GROUP_ADMINS_KIND)
      .sort((a: NostrEventLike, b: NostrEventLike) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];

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
}

export async function setGroupPermissions(
  client: NostrClient,
  groupId: string,
  pubkey: string,
  permissions: AdminPermission[],
): Promise<{ ok: boolean; reason?: string }> {
  const read = await readGroupAdmins(client, groupId);
  if (!read.ok) {
    return { ok: false, reason: 'Could not read the current permissions, so nothing was changed.' };
  }

  const others = read.entries.filter((e) => e.pubkey !== pubkey);
  const next = [...others, { pubkey, permissions }];

  const count = await client.signAndPublish({
    kind: GROUP_ADMINS_KIND,
    content: '',
    tags: buildAdminTags(groupId, next),
  });
  if (count === 0) throw new Error('No relay accepted the change.');
  return { ok: true };
}

export async function updateGroupMetadata(
  client: NostrClient,
  groupId: string,
  edit: GroupMetadataEdit,
): Promise<{ ok: boolean; reason?: string }> {
  if (!edit.name?.trim()) {
    return { ok: false, reason: 'A project needs a name. Nothing was changed.' };
  }

  const tags: string[][] = [['d', groupId]];
  if (edit.name?.trim()) tags.push(['name', edit.name.trim()]);
  if (edit.about?.trim()) tags.push(['about', edit.about.trim()]);
  if (edit.picture?.trim()) tags.push(['picture', edit.picture.trim()]);

  const count = await client.signAndPublish({
    kind: GROUP_METADATA_KIND,
    content: '',
    tags,
  });
  if (count === 0) throw new Error('No relay accepted the change.');
  return { ok: true };
}
