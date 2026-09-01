/**
 * @fileoverview Every project admin capability has a caller.
 *
 * useGroupAdmin.updateMetadata shipped with the guards right, the addressable
 * kind:39000 replacement hazard handled, and ZERO CALLERS. The operator went
 * looking for a way to edit their project, did not find one, and reported the
 * capability as missing -- correctly, because from outside there was no
 * difference between "not built" and "built and unreachable".
 *
 * That is the sixth instance of declared-but-unwired in this estate and the
 * first we created after naming the pattern. "The function exists" and "a user
 * can do it" are different claims, and the gap is invisible from inside a diff.
 *
 * So this asserts the second claim, not the first.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');

/** Every source file, so a caller anywhere counts. */
function allSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) allSources(full, acc);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const files = allSources(SRC).map((f) => ({ path: f, text: readFileSync(f, 'utf8') }));

/** Files that USE a symbol, excluding the module that defines it. */
function callersOf(symbol: string, definedIn: string) {
  return files.filter((f) => !f.path.endsWith(definedIn) && f.text.includes(symbol));
}

describe('project admin capabilities are reachable', () => {
  for (const capability of ['updateMetadata', 'addMember', 'removeMember']) {
    it(`${capability} has a caller outside useGroupAdmin`, () => {
      const callers = callersOf(capability, 'useGroupAdmin.ts');

      expect(
        callers.length,
        `${capability} is exported and nothing calls it — a user cannot reach it`
      ).toBeGreaterThan(0);
    });
  }

  it('the settings panel is rendered, not merely defined', () => {
    const callers = callersOf('GroupSettings', 'GroupSettings.tsx');

    expect(callers.length).toBeGreaterThan(0);
  });

  it('transferOwnership has a caller outside useGroupOwner', () => {
    // The transfer action must be reachable from the UI, not merely defined.
    const callers = callersOf('transferOwnership', 'useGroupOwner.ts');

    expect(
      callers.length,
      'transferOwnership is exported and nothing calls it — the owner cannot reach the transfer UI'
    ).toBeGreaterThan(0);
  });
});
