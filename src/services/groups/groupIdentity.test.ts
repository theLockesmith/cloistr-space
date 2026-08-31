/**
 * @fileoverview Group.id and Group.identifier are different things.
 *
 * Operator: "when I open the settings, everything is empty."
 *
 * The relay data was fine -- the kind:39000 events carry `name='Test Project'`
 * and parseGroupEvent reads it correctly. The settings panel looked the group
 * up by the WRONG FIELD:
 *
 *     Group.id         = the kind:39000 EVENT id, a 64-char hash
 *     Group.identifier = the d-tag, "test-project-t9mn5b1"
 *
 * ProjectsView passes `group.identifier` as groupId, and the kind:39001/39002
 * filters use `#d`. So the d-tag is the group's identity everywhere except in
 * one `find`, which compared it against an event id and never matched.
 *
 * The field names invite this: `id` reads like the identity and is not. These
 * assert the semantics so the next lookup is written against the right one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');

function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, acc);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

describe('group identity', () => {
  it('nothing looks a group up by .id against a groupId prop', () => {
    // groupId is always a d-tag. Matching it against Group.id -- the event id --
    // silently finds nothing, and a "not found" that renders as an empty form
    // is how this reached the operator.
    const offenders = sources(SRC)
      .map((path) => ({ path, text: readFileSync(path, 'utf8') }))
      .filter(({ text }) => /\.group\.id === groupId|\.id === groupId/.test(text));

    expect(
      offenders.map((o) => o.path),
      'group lookups must match on identifier (the d-tag), not id (the event id)'
    ).toEqual([]);
  });

  it('ProjectsView still hands the d-tag down', () => {
    // If this ever changes to pass the event id, the lookup above must change
    // with it -- and the two are indistinguishable at a glance.
    const view = readFileSync(join(SRC, 'components', 'projects', 'ProjectsView.tsx'), 'utf8');

    expect(view).toMatch(/groupId=\{selectedGroup\.group\.identifier\}/);
  });

  it('the settings panel refuses to render a form without the project', () => {
    // The data-loss half. kind:39000 is addressable, so saving a blank form
    // publishes a record with no name and WIPES it. A blank field and an
    // unloaded project are different facts and only one is safe to save.
    const settings = readFileSync(
      join(SRC, 'components', 'projects', 'GroupSettings.tsx'),
      'utf8'
    );

    expect(settings).toMatch(/if \(!group\)/);
    expect(settings).toMatch(/Could not load this project/);
  });

  it('the service refuses a nameless save independently of the UI', () => {
    // A guard living only in a component is one refactor away from gone, and
    // the cost of being wrong is the name of somebody's project.
    const admin = readFileSync(join(__dirname, 'useGroupAdmin.ts'), 'utf8');

    expect(admin).toMatch(/A project needs a name/);
  });
});
