/**
 * @fileoverview No control gates on a derived isAdmin.
 *
 * kind:39001 carries SIX permissions per pubkey. A single derived boolean is a
 * lossy summary of them: it grants someone holding only `add-user` the remove
 * button, or denies it to someone who legitimately has `remove-user` and
 * nothing else.
 *
 * Gating on the specific permission each control needs also dissolves the
 * question of what "admin" means -- there is no definition to choose or
 * document, because every gate states its own reason at the point of use.
 *
 * "Admin" survives only as a PRESET NAME, never as a computed status, so the
 * word means one thing in the product rather than two.
 *
 * useGroupMembers may still DERIVE isAdmin for display; nothing may GATE on it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PROJECTS = __dirname;

const files = readdirSync(PROJECTS)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ name: f, text: readFileSync(join(PROJECTS, f), 'utf8') }));

describe('permission gating', () => {
  it('nothing gates on m.isAdmin', () => {
    // The exact expression that was there: `members.some(m => ... && m.isAdmin)`.
    const offenders = files.filter(({ text }) => /\.isAdmin\b/.test(text) && /can(Admin|Act|Remove|Edit)/.test(text) && !/permissions/.test(text));

    expect(offenders.map((o) => o.name)).toEqual([]);
  });

  it('each control names the permission it needs', () => {
    const members = files.find((f) => f.name === 'GroupMembers.tsx')!.text;

    expect(members).toMatch(/can\(myPermissions, 'add-user'\)/);
    expect(members).toMatch(/can\(myPermissions, 'remove-user'\)/);
    expect(members).toMatch(/'add-permission'|'remove-permission'/);
  });

  it('the settings tab gates on edit-metadata', () => {
    // Settings edits kind:39000. Someone holding exactly edit-metadata should
    // get the tab; someone holding six others but not that one should not.
    const workspace = files.find((f) => f.name === 'GroupWorkspace.tsx')!.text;

    expect(workspace).toMatch(/'edit-metadata'/);
  });

  it('custom is displayed but never assignable', () => {
    // It DESCRIBES a set matching no preset. Offering it as a choice would make
    // it a state you could select, which is meaningless.
    const editor = files.find((f) => f.name === 'MemberPermissions.tsx')!.text;

    expect(editor).toMatch(/\['admin', 'moderator', 'member'\] as const/);
    expect(editor).toMatch(/role === 'custom'/);
  });
});
