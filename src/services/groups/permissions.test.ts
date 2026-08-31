/**
 * @fileoverview Tests for group permissions.
 *
 * kind:39001 carries six permissions per pubkey. The UI collapsed them into one
 * boolean and could not edit any.
 *
 * The load-bearing property is that the model is NEVER coerced: a permission
 * set written by another NIP-29 client must survive contact with our UI. The
 * binary would have silently promoted someone holding only `add-user` to a full
 * admin the first time we touched them, which destroys information rather than
 * ignoring it.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  PERMISSION_LABEL,
  ROLE_LABEL,
  can,
  roleFor,
  permissionsForRole,
  togglePermission,
  permissionEditRefusal,
  PERMISSION_REFUSAL_MESSAGE,
  buildAdminTags,
} from './permissions';
import type { AdminPermission } from '@/types/groups';

const ME = 'a'.repeat(64);
const THEM = 'b'.repeat(64);
const FULL: AdminPermission[] = [...ALL_PERMISSIONS];

describe('roleFor', () => {
  it('recognises the presets', () => {
    expect(roleFor(FULL)).toBe('admin');
    expect(roleFor(['remove-user', 'delete-event'])).toBe('moderator');
    expect(roleFor([])).toBe('member');
  });

  it('does not care about order', () => {
    expect(roleFor(['delete-event', 'remove-user'])).toBe('moderator');
  });

  it('reports an unmatched set as CUSTOM rather than the nearest preset', () => {
    // The whole point. Someone granted only add-user by another client is not
    // an admin and is not a member, and calling them either would misrepresent
    // what the relay actually says.
    expect(roleFor(['add-user'])).toBe('custom');
    expect(roleFor(['add-user', 'edit-metadata'])).toBe('custom');
  });

  it('compares sets, not sizes', () => {
    // Moderator is two permissions. A different two is not moderator.
    expect(roleFor(['add-user', 'edit-metadata'])).toBe('custom');
  });
});

describe('can', () => {
  it('is the only gate a control needs', () => {
    expect(can(['add-user'], 'add-user')).toBe(true);
    expect(can(['add-user'], 'remove-user')).toBe(false);
  });

  it('grants nothing to someone with nothing', () => {
    for (const p of ALL_PERMISSIONS) expect(can([], p)).toBe(false);
  });
});

describe('togglePermission', () => {
  it('adds and removes', () => {
    expect(togglePermission([], 'add-user')).toEqual(['add-user']);
    expect(togglePermission(['add-user'], 'add-user')).toEqual([]);
  });

  it('preserves everything else', () => {
    const next = togglePermission(FULL, 'delete-event');

    expect(next).not.toContain('delete-event');
    expect(next).toHaveLength(ALL_PERMISSIONS.length - 1);
  });

  it('keeps a stable order regardless of edit sequence', () => {
    // Two people reaching the same permission set must produce the same tag, or
    // the events differ for no reason.
    const a = togglePermission(togglePermission([], 'remove-user'), 'add-user');
    const b = togglePermission(togglePermission([], 'add-user'), 'remove-user');

    expect(a).toEqual(b);
  });
});

describe('permissionEditRefusal', () => {
  it('allows an editor with add-permission to change someone else', () => {
    expect(permissionEditRefusal(ME, ['add-permission'], THEM, ['add-user'])).toBeNull();
  });

  it('refuses an editor holding neither permission-management right', () => {
    expect(permissionEditRefusal(ME, ['add-user'], THEM, ['add-user'])).toBe('not-permitted');
  });

  it('refuses a signed-out editor', () => {
    expect(permissionEditRefusal(null, FULL, THEM, [])).toBe('not-permitted');
  });

  it('refuses removing your OWN permission-management rights', () => {
    // Leaves you unable to undo it from this UI.
    expect(permissionEditRefusal(ME, FULL, ME, ['add-user'])).toBe('self-lockout');
  });

  it('allows editing your own OTHER permissions', () => {
    // Dropping your own delete-event is fine -- you can still restore it.
    const next: AdminPermission[] = ['add-permission', 'remove-permission', 'add-user'];

    expect(permissionEditRefusal(ME, FULL, ME, next)).toBeNull();
  });

  it('allows keeping just one of the two management rights', () => {
    expect(permissionEditRefusal(ME, FULL, ME, ['remove-permission'])).toBeNull();
  });

  it('does not claim the self-guard is permanent', () => {
    // With NIP-29 off, anyone can publish a corrected kind:39001 from any
    // client. The guard prevents a CONFUSING state, not an irreversible one,
    // and wording it as a lockout would overstate what we can promise.
    expect(PERMISSION_REFUSAL_MESSAGE['self-lockout']).not.toMatch(/permanent|forever|cannot be undone/i);
  });
});

describe('buildAdminTags', () => {
  it('writes pubkey then permissions', () => {
    expect(buildAdminTags('g', [{ pubkey: ME, permissions: ['add-user', 'remove-user'] }])).toEqual([
      ['d', 'g'],
      ['p', ME, 'add-user', 'remove-user'],
    ]);
  });

  it('OMITS someone with no permissions', () => {
    // A bare ["p", pubkey] lists them as an admin holding nothing, which other
    // clients may read either way. Someone with no permissions is not an admin
    // and does not belong in kind:39001.
    expect(buildAdminTags('g', [{ pubkey: ME, permissions: [] }])).toEqual([['d', 'g']]);
  });

  it('keeps everyone else when one person is demoted', () => {
    const tags = buildAdminTags('g', [
      { pubkey: ME, permissions: [] },
      { pubkey: THEM, permissions: ['add-user'] },
    ]);

    expect(tags).toEqual([['d', 'g'], ['p', THEM, 'add-user']]);
  });
});

describe('labels', () => {
  it('every permission and role has wording', () => {
    // A gate with no label renders an empty explanation, which is the
    // silent-refusal failure in a new place.
    for (const p of ALL_PERMISSIONS) expect(PERMISSION_LABEL[p]).toBeTruthy();
    for (const r of ['admin', 'moderator', 'member', 'custom'] as const) {
      expect(ROLE_LABEL[r]).toBeTruthy();
    }
  });

  it('admin is every permission', () => {
    expect(new Set(ROLE_PERMISSIONS.admin)).toEqual(new Set(ALL_PERMISSIONS));
    expect(permissionsForRole('admin')).toHaveLength(ALL_PERMISSIONS.length);
  });
});
