/**
 * @fileoverview Verify the vitest configuration's exclude patterns.
 *
 * The `.worktrees/**` exclude was added after a stale git worktree caused 8
 * phantom test failures by running tests from a different branch against this
 * branch's node_modules. This suite asserts that the exclude list covers the
 * patterns that matter, so removing one by accident is caught before CI.
 */

import { describe, it, expect } from 'vitest';
import { minimatch } from 'minimatch';

/**
 * The exclude list from vitest.config.ts, kept in sync manually.
 *
 * Why duplicate rather than import? vitest.config.ts exports a Vite
 * UserConfig, not a plain object. Importing it would pull in the Vite
 * plugin pipeline, which is not something a unit test should do. The
 * tradeoff: if someone edits the config's exclude array without updating
 * this list, the drift test at the bottom catches it.
 */
const EXCLUDES = [
  'node_modules/**',
  'tests/**',
  '**/*.browser.test.{ts,tsx}',
  'src/test/browser-apis.test.ts',
  '.worktrees/**',
];

/** True when at least one exclude pattern matches `filePath`. */
function isExcluded(filePath: string): boolean {
  return EXCLUDES.some((pattern) => minimatch(filePath, pattern));
}

describe('vitest exclude patterns', () => {
  it('excludes files inside .worktrees/', () => {
    expect(isExcluded('.worktrees/feat/group-ownership/src/components/auth/SignerErrorOverlay.test.tsx')).toBe(true);
    expect(isExcluded('.worktrees/some-branch/tests/e2e/app.spec.ts')).toBe(true);
  });

  it('excludes node_modules', () => {
    expect(isExcluded('node_modules/some-pkg/test.ts')).toBe(true);
  });

  it('excludes Playwright E2E tests under tests/', () => {
    expect(isExcluded('tests/e2e/auth.spec.ts')).toBe(true);
  });

  it('excludes browser-only test files', () => {
    expect(isExcluded('src/lib/crypto.browser.test.ts')).toBe(true);
    expect(isExcluded('src/components/foo.browser.test.tsx')).toBe(true);
    expect(isExcluded('src/test/browser-apis.test.ts')).toBe(true);
  });

  it('does NOT exclude regular test files in src/', () => {
    expect(isExcluded('src/services/cache/nostrCache.test.ts')).toBe(false);
    expect(isExcluded('src/components/social/Feed.test.tsx')).toBe(false);
  });

  // Drift detector: read the actual config and compare. This catches someone
  // editing the config's exclude list without updating EXCLUDES above.
  it('matches the exclude list in vitest.config.ts', async () => {
    const fs = await import('fs');
    const configText = fs.readFileSync('vitest.config.ts', 'utf-8');

    // Extract the exclude array from the config source. The array spans from
    // "exclude: [" to the matching "]". We parse the string entries rather
    // than evaling the module.
    const excludeMatch = configText.match(/exclude:\s*\[([\s\S]*?)\]/);
    expect(excludeMatch).not.toBeNull();

    const rawBlock = excludeMatch![1];
    // Strip single-line comments before extracting quoted strings, because
    // the exclude array has inline comments that contain quoted fragments.
    const withoutComments = rawBlock.replace(/\/\/.*$/gm, '');
    const entries = [...withoutComments.matchAll(/'([^']+)'|"([^"]+)"/g)]
      .map((m) => m[1] ?? m[2]);

    expect(entries).toEqual(EXCLUDES);
  });
});
