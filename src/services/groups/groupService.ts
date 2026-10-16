/**
 * Pure group operations, callable without React.
 *
 * Each function accepts a SignerInterface (from @cloistr/auth/core) and a
 * RelayClient. The React hooks in useGroupActions and useGroupAdmin provide
 * NDK-backed implementations; a headless caller provides its own.
 */

import { signAndPublish, type SignerInterface, type RelayClient } from '../headless';
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
  signer: SignerInterface,
  relay: RelayClient,
  groupId: string,
  message?: string,
): Promise<void> {
  await signAndPublish(signer, relay, {
    kind: GROUP_JOIN_REQUEST_KIND,
    content: message || '',
    tags: [['h', groupId]],
  });
}

export async function leaveGroup(
  signer: SignerInterface,
  relay: RelayClient,
  groupId: string,
): Promise<void> {
  await signAndPublish(signer, relay, {
    kind: GROUP_LEAVE_REQUEST_KIND,
    content: '',
    tags: [['h', groupId]],
  });
}

export type GroupCreateStep = 'metadata' | 'admins' | 'members';

/**
 * A group creation in progress. Creating a group is three publishes, and
 * Nostr cannot make them atomic, so the caller keeps this across a failure
 * and passes it back to finish the same group rather than mint a second one.
 */
export interface PendingGroup {
  readonly identifier: string;
  /** The key the group was begun under; only that key can finish it. */
  readonly owner: string;
  /**
   * Steps a relay accepted. The binding is readonly; the set is not:
   * createGroup adds to it as each step lands, so the caller's copy stays current.
   */
  readonly published: Set<GroupCreateStep>;
}

/** Mint the identifier before anything is published. */
export async function beginGroupCreation(
  signer: SignerInterface,
  name: string,
): Promise<PendingGroup> {
  const owner = await signer.getPublicKey();
  return { identifier: buildGroupIdentifier(name, owner), owner, published: new Set() };
}

/**
 * Create a group, or finish one a previous attempt left partly published.
 *
 * Without `pending` this begins a fresh group, and a failure partway loses
 * its identifier: hold a PendingGroup from beginGroupCreation when a retry is
 * possible. With it, only steps not yet in `pending.published` are sent. A
 * step that timed out is not recorded and is sent again; that is safe because
 * all three kinds are addressable, so the relay keeps one copy per group.
 *
 * A resume does not read the group first. The admins and members steps carry
 * only the creator, so if someone else published a member list for this
 * identifier between attempts, finishing would replace it. Accepted: it needs
 * someone else to find a half-made group and edit its member list in the gap
 * before the creator's retry.
 */
export async function createGroup(
  signer: SignerInterface,
  relay: RelayClient,
  options: CreateGroupOptions,
  pending?: PendingGroup,
): Promise<string> {
  const group = pending ?? (await beginGroupCreation(signer, options.name));
  const pubkey = await signer.getPublicKey();
  if (pubkey !== group.owner) {
    throw new Error('This group was started under a different key. Switch back to it to finish creating the group.');
  }

  const { identifier } = group;
  const { name, description, picture, isPublic = true, isOpen = false } = options;

  const metadataTags: string[][] = [
    ['d', identifier],
    ['name', name],
  ];
  if (description) metadataTags.push(['about', description]);
  if (picture) metadataTags.push(['picture', picture]);
  metadataTags.push([isPublic ? 'public' : 'private']);
  metadataTags.push([isOpen ? 'open' : 'closed']);

  const steps: Array<[GroupCreateStep, { kind: number; content: string; tags: string[][] }]> = [
    ['metadata', { kind: GROUP_METADATA_KIND, content: description || '', tags: metadataTags }],
    [
      'admins',
      {
        kind: GROUP_ADMINS_KIND,
        content: '',
        tags: [
          ['d', identifier],
          ['p', pubkey, 'add-user', 'remove-user', 'edit-metadata', 'delete-event', 'add-permission', 'remove-permission'],
        ],
      },
    ],
    [
      'members',
      {
        kind: GROUP_MEMBERS_KIND,
        content: '',
        tags: [
          ['d', identifier],
          ['p', pubkey],
        ],
      },
    ],
  ];

  for (const [step, template] of steps) {
    if (group.published.has(step)) continue;
    await signAndPublish(signer, relay, template);
    group.published.add(step);
  }

  return identifier;
}

// --- Read operations ---

export async function readGroupMembers(
  relay: RelayClient,
  groupId: string,
): Promise<MemberRead> {
  try {
    const events = await relay.fetch({
      kinds: [GROUP_METADATA_KIND, GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND],
      '#d': [groupId],
    });

    // A project being edited always has a 39000. Finding none means this read
    // did not reach it, not that the project is empty: an edit built on it
    // would replace the whole list (sweep #7).
    if (!events.some((e) => e.kind === GROUP_METADATA_KIND)) return { ok: false, members: [] };

    // Safe cast: resolveTrustedWriters only reads kind, pubkey, tags,
    // created_at, id. nostr-tools Event has all of these.
    const writers = resolveTrustedWriters(groupId, events as any);

    if (writers.status === 'resolved') {
      // No member list from a trusted writer is "could not tell", not "nobody".
      const trusted = events.some(
        (e) => e.kind === GROUP_MEMBERS_KIND && writers.memberWriters.has(e.pubkey),
      );
      if (!trusted) return { ok: false, members: [] };
      return { ok: true, members: authoritativeMembers(writers, events as any) ?? [] };
    }

    const latest = events
      .filter((e) => e.kind === GROUP_MEMBERS_KIND)
      .sort((a, b) => b.created_at - a.created_at)[0];

    if (!latest) return { ok: false, members: [] };

    return {
      ok: true,
      members: latest.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]),
    };
  } catch {
    return { ok: false, members: [] };
  }
}

export async function addGroupMember(
  signer: SignerInterface,
  relay: RelayClient,
  groupId: string,
  pubkey: string,
): Promise<{ ok: true } | { ok: false; reason: EditRefusal }> {
  const read = await readGroupMembers(relay, groupId);
  const result = membersAfterAdd(read, pubkey);
  if (!result.ok) return result;

  await signAndPublish(signer, relay, {
    kind: GROUP_MEMBERS_KIND,
    content: '',
    tags: buildMemberTags(groupId, result.members),
  });
  return { ok: true };
}

export async function removeGroupMember(
  signer: SignerInterface,
  relay: RelayClient,
  groupId: string,
  pubkey: string,
): Promise<{ ok: true } | { ok: false; reason: EditRefusal }> {
  const read = await readGroupMembers(relay, groupId);
  const result = membersAfterRemove(read, pubkey);
  if (!result.ok) return result;

  await signAndPublish(signer, relay, {
    kind: GROUP_MEMBERS_KIND,
    content: '',
    tags: buildMemberTags(groupId, result.members),
  });
  return { ok: true };
}

export async function readGroupAdmins(
  relay: RelayClient,
  groupId: string,
): Promise<{
  ok: boolean;
  entries: { pubkey: string; permissions: AdminPermission[] }[];
  ownerPubkey?: string;
}> {
  try {
    const events = await relay.fetch({
      kinds: [GROUP_METADATA_KIND, GROUP_ADMINS_KIND],
      '#d': [groupId],
    });

    // Same rule as readGroupMembers: no 39000 means the read missed the project.
    if (!events.some((e) => e.kind === GROUP_METADATA_KIND)) return { ok: false, entries: [] };

    const writers = resolveTrustedWriters(groupId, events as any);

    if (writers.status === 'resolved') {
      // Only the owner writes 39001; without the owner's list there is nothing to edit from.
      if (!events.some((e) => e.kind === GROUP_ADMINS_KIND && e.pubkey === writers.owner)) {
        return { ok: false, entries: [] };
      }
      return { ok: true, entries: writers.admins, ownerPubkey: writers.owner };
    }

    const latest = events
      .filter((e) => e.kind === GROUP_ADMINS_KIND)
      .sort((a, b) => b.created_at - a.created_at)[0];

    if (!latest) return { ok: false, entries: [] };

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
  signer: SignerInterface,
  relay: RelayClient,
  groupId: string,
  pubkey: string,
  permissions: AdminPermission[],
): Promise<{ ok: boolean; reason?: string }> {
  const read = await readGroupAdmins(relay, groupId);
  if (!read.ok) {
    return { ok: false, reason: 'Could not read the current permissions, so nothing was changed.' };
  }

  const others = read.entries.filter((e) => e.pubkey !== pubkey);
  const next = [...others, { pubkey, permissions }];

  await signAndPublish(signer, relay, {
    kind: GROUP_ADMINS_KIND,
    content: '',
    tags: buildAdminTags(groupId, next),
  });
  return { ok: true };
}

export async function updateGroupMetadata(
  signer: SignerInterface,
  relay: RelayClient,
  groupId: string,
  edit: GroupMetadataEdit,
): Promise<{ ok: boolean; reason?: string }> {
  if (!edit.name?.trim()) {
    return { ok: false, reason: 'A project needs a name. Nothing was changed.' };
  }

  // 39000 is addressable: this publish replaces the whole event. Build it on
  // the current one from someone allowed to write it, carrying every tag the
  // edit does not change (private/public, closed/open, ...). No such event
  // read: publish nothing (sweep #7).
  let current: { tags: string[][] } | undefined;
  try {
    const events = await relay.fetch({ kinds: [GROUP_METADATA_KIND, GROUP_ADMINS_KIND], '#d': [groupId] });
    const writers = resolveTrustedWriters(groupId, events as unknown as Parameters<typeof resolveTrustedWriters>[1]);
    if (writers.status === 'resolved') {
      const editors = new Set([
        writers.owner,
        ...writers.admins.filter((a) => a.permissions.includes('edit-metadata')).map((a) => a.pubkey),
      ]);
      current = events
        .filter((e) => e.kind === GROUP_METADATA_KIND && editors.has(e.pubkey))
        .sort((a, b) => b.created_at - a.created_at || (b.id < a.id ? -1 : 1))[0];
    }
  } catch {
    current = undefined;
  }
  if (!current) {
    return { ok: false, reason: 'Could not read the project as it is now, so nothing was changed.' };
  }

  const EDITED = new Set(['d', 'name', 'about', 'picture']);
  const tags: string[][] = [['d', groupId], ...current.tags.filter((t) => !EDITED.has(t[0]))];
  if (edit.name?.trim()) tags.push(['name', edit.name.trim()]);
  if (edit.about?.trim()) tags.push(['about', edit.about.trim()]);
  if (edit.picture?.trim()) tags.push(['picture', edit.picture.trim()]);

  await signAndPublish(signer, relay, {
    kind: GROUP_METADATA_KIND,
    content: '',
    tags,
  });
  return { ok: true };
}
