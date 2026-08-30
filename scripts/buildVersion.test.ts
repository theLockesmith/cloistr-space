/**
 * @fileoverview Tests for build identity resolution.
 *
 * The invariant that matters: this NEVER invents a commit. A build that does
 * not know what it is must say "unknown", because the probe's whole job is to
 * distinguish "this is the build you wanted" from "I cannot tell" -- and a
 * plausible-looking fabricated SHA collapses those into each other, which is
 * the failure the probe exists to prevent.
 */

import { describe, it, expect } from 'vitest';
import { resolveBuildVersion } from './buildVersion';

const SHA = /^[0-9a-f]{40}$/;

describe('resolveBuildVersion', () => {
  it('prefers CI values over git', () => {
    // In CI the checkout is often detached, so `git rev-parse --abbrev-ref HEAD`
    // reports HEAD rather than the branch. CI_COMMIT_REF_NAME is the truth there.
    const v = resolveBuildVersion({
      CI_COMMIT_SHA: 'a'.repeat(40),
      CI_COMMIT_REF_NAME: 'master',
      CI_PIPELINE_ID: '35271',
    } as NodeJS.ProcessEnv);

    expect(v.commit).toBe('a'.repeat(40));
    expect(v.ref).toBe('master');
    expect(v.pipeline).toBe('35271');
  });

  it('marks a local build as local rather than guessing a pipeline', () => {
    const v = resolveBuildVersion({ CI_COMMIT_SHA: 'b'.repeat(40) } as NodeJS.ProcessEnv);

    expect(v.pipeline).toBe('local');
  });

  it('falls back to git when CI vars are absent', () => {
    const v = resolveBuildVersion({} as NodeJS.ProcessEnv);

    expect(v.commit).toMatch(SHA);
  });

  it('never produces a commit that is neither a sha nor "unknown"', () => {
    // The load-bearing assertion. Anything else here -- an empty string, a
    // truncated hash, a git error message -- would be compared against an
    // expected SHA by the probe and reported as a mismatch, sending someone to
    // debug a deploy that was fine.
    const v = resolveBuildVersion({} as NodeJS.ProcessEnv);

    expect(v.commit === 'unknown' || SHA.test(v.commit)).toBe(true);
  });

  it('stamps a parseable ISO timestamp', () => {
    const v = resolveBuildVersion({ CI_COMMIT_SHA: 'c'.repeat(40) } as NodeJS.ProcessEnv);

    expect(Number.isNaN(Date.parse(v.builtAt))).toBe(false);
  });
});
