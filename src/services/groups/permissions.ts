/**
 * @fileoverview Group permissions: roles as presets over the real model.
 *
 * kind:39001 already carries SIX distinct permissions per pubkey, written at
 * group creation. The UI collapsed them into one `isAdmin` boolean and could
 * not edit any of them.
 *
 * WHY NOT KEEP THE BINARY. Collapsing to admin/member does not merely lose
 * expressiveness -- it DESTROYS information another client wrote. Someone
 * granted only `add-user` by a different NIP-29 client would silently become a
 * full admin the first time our UI touched them. Ignoring data is recoverable;
 * rewriting it is not.
 *
 * WHY NOT SIX RAW CHECKBOXES EITHER. Nobody reasons about `delete-event`
 * separately from `remove-user`, and the person using this is looking for "make
 * them an admin".
 *
 * SO: named roles as presets OVER the real model. Picking a role sets its
 * permissions; editing an individual permission moves the person to `custom`
 * rather than silently reinterpreting them. The common case is one click, an
 * unusual set from another client survives and is shown honestly, and we never
 * write a state the user did not choose.
 *
 * "ADMIN" IS A PRESET NAME, NEVER A COMPUTED STATUS. Controls are gated on the
 * permission each one actually needs -- see `can` -- so no derived isAdmin
 * exists to be defined or argued about. A single boolean is a lossy summary of
 * a six-field model, and gating on one would reintroduce in the permission
 * layer exactly the collapse this module rejects in the editing layer.
 */

import type { AdminPermission } from '@/types/groups';

export const ALL_PERMISSIONS: AdminPermission[] = [
  'add-user',
  'remove-user',
  'edit-metadata',
  'delete-event',
  'add-permission',
  'remove-permission',
];

/** Human wording for each permission, for a UI that has to explain itself. */
export const PERMISSION_LABEL: Record<AdminPermission, string> = {
  'add-user': 'Add members',
  'remove-user': 'Remove members',
  'edit-metadata': 'Edit project details',
  'delete-event': 'Delete posts',
  'add-permission': 'Grant permissions',
  'remove-permission': 'Revoke permissions',
};

export type Role = 'admin' | 'moderator' | 'member' | 'custom';

/**
 * Presets. `custom` is deliberately absent -- it is a DESCRIPTION of a set that
 * matches no preset, not something you can assign.
 */
export const ROLE_PERMISSIONS: Record<Exclude<Role, 'custom'>, AdminPermission[]> = {
  admin: ALL_PERMISSIONS,
  moderator: ['remove-user', 'delete-event'],
  member: [],
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  moderator: 'Moderator',
  member: 'Member',
  custom: 'Custom',
};

/** Does this person hold this permission? The only gate any control should use. */
export function can(permissions: AdminPermission[], permission: AdminPermission): boolean {
  return permissions.includes(permission);
}

/**
 * Which preset a permission set corresponds to, or `custom`.
 *
 * Set comparison, not length: two sets of the same size are not the same set,
 * and reporting `moderator` for someone holding add-user and edit-metadata
 * would be the same misrepresentation as the binary.
 */
export function roleFor(permissions: AdminPermission[]): Role {
  const held = new Set(permissions);

  for (const [role, preset] of Object.entries(ROLE_PERMISSIONS) as [
    Exclude<Role, 'custom'>,
    AdminPermission[],
  ][]) {
    if (preset.length !== held.size) continue;
    if (preset.every((p) => held.has(p))) return role;
  }

  return 'custom';
}

export function permissionsForRole(role: Exclude<Role, 'custom'>): AdminPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** Toggle one permission, preserving the rest and the order of ALL_PERMISSIONS. */
export function togglePermission(
  permissions: AdminPermission[],
  permission: AdminPermission
): AdminPermission[] {
  const held = new Set(permissions);
  if (held.has(permission)) held.delete(permission);
  else held.add(permission);

  return ALL_PERMISSIONS.filter((p) => held.has(p));
}

export type PermissionRefusal = 'self-lockout' | 'not-permitted' | 'owner-protected';

export const PERMISSION_REFUSAL_MESSAGE: Record<PermissionRefusal, string> = {
  // Careful wording. With NIP-29 off, this is NOT a lockout: anyone can publish
  // a corrected kind:39001 from any client, including this one. The guard
  // prevents a CONFUSING state, not an irreversible one, and saying otherwise
  // would overstate what we can promise.
  'self-lockout': 'You cannot remove your own ability to manage permissions.',
  'not-permitted': 'You do not have permission to change this.',
  // Careful wording again. "Only the owner can do this" would overstate what
  // we can promise with NIP-29 off — a hostile client can publish a
  // replacement kind:39001 from any key. What we CAN say: this client, and
  // any client that checks the group's creation event, derives ownership from
  // the event record and will reject a contradictory claim.
  'owner-protected':
    'This client, and any client that checks the creation event, recognises this person as the group owner. Their permissions can only be changed through an ownership transfer.',
};

/**
 * Whether an edit may proceed.
 *
 * The self-check exists because a user removing their own permission-management
 * rights leaves themselves unable to undo it FROM THIS UI. It is recoverable
 * from any other client, which is why the message does not claim permanence.
 *
 * ownerPubkey, when provided, activates the owner-protection check: the owner's
 * permissions cannot be changed by anyone other than the owner themselves (via
 * an ownership transfer, not a permission edit). The check is checked before
 * any other so it cannot be bypassed by an editor with permission-management
 * rights.
 */
export function permissionEditRefusal(
  editorPubkey: string | null,
  editorPermissions: AdminPermission[],
  targetPubkey: string,
  next: AdminPermission[],
  ownerPubkey?: string
): PermissionRefusal | null {
  if (!editorPubkey) return 'not-permitted';

  // Owner protection: checked first, before permission checks. An editor with
  // full permissions still cannot demote the owner through this control.
  if (ownerPubkey && targetPubkey === ownerPubkey && editorPubkey !== ownerPubkey) {
    return 'owner-protected';
  }

  if (!can(editorPermissions, 'add-permission') && !can(editorPermissions, 'remove-permission')) {
    return 'not-permitted';
  }

  if (editorPubkey === targetPubkey) {
    const keepsControl =
      next.includes('add-permission') || next.includes('remove-permission');
    if (!keepsControl) return 'self-lockout';
  }

  return null;
}

/** kind:39001 tags: `["p", pubkey, ...permissions]` for every admin. */
export function buildAdminTags(
  groupId: string,
  entries: { pubkey: string; permissions: AdminPermission[] }[]
): string[][] {
  return [
    ['d', groupId],
    // Someone with NO permissions is not an admin and does not belong in
    // kind:39001 at all. Writing a bare `["p", pubkey]` would list them as an
    // admin holding nothing, which other clients may read either way.
    ...entries
      .filter((e) => e.permissions.length > 0)
      .map((e) => ['p', e.pubkey, ...e.permissions]),
  ];
}
