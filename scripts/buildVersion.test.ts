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
import { execSync } from 'node:child_process';
import { resolveBuildVersion, assertIdentified } from './buildVersion';

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

  it('falls back to git when CI vars are absent and git is available', () => {
    // Conditional on git actually existing, which is NOT a property of this
    // code. The first version of this test asserted a 40-hex SHA
    // unconditionally and passed locally, then failed in CI -- node:22-alpine
    // ships no git binary, so the fallback correctly returned "unknown" and the
    // test called correct behaviour a failure.
    //
    // Asserting the environment instead of the behaviour is its own bug. The
    // environment-independent property is the test below, which passed in both.
    const hasGit = (() => {
      try {
        execSync('git rev-parse HEAD', { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })();

    const v = resolveBuildVersion({} as NodeJS.ProcessEnv);

    if (hasGit) {
      expect(v.commit).toMatch(SHA);
    } else {
      expect(v.commit).toBe('unknown');
    }
  });

  it('never produces a commit that is neither a sha nor "unknown"', () => {
    // The load-bearing assertion. Anything else here -- an empty string, a
    // truncated hash, a git error message -- would be compared against an
    // expected SHA by the probe and reported as a mismatch, sending someone to
    // debug a deploy that was fine.
    const v = resolveBuildVersion({} as NodeJS.ProcessEnv);

    expect(v.commit === 'unknown' || SHA.test(v.commit)).toBe(true);
  });

  it('refuses to build in CI without a resolvable commit', () => {
    // Shipping a bundle that cannot say what it is makes the probe useless in
    // the one place it matters. Locally that is a nuisance; in CI it is a
    // deployable artifact with no identity, so the build fails instead.
    expect(() => assertIdentified({ commit: 'unknown' } as never, { CI: 'true' } as never)).toThrow(
      /identify itself/
    );
  });

  it('allows a local build with no git to proceed', () => {
    // Dev convenience. A local build is not a deployable artifact.
    expect(() =>
      assertIdentified({ commit: 'unknown' } as never, {} as never)
    ).not.toThrow();
  });

  it('stamps a parseable ISO timestamp', () => {
    const v = resolveBuildVersion({ CI_COMMIT_SHA: 'c'.repeat(40) } as NodeJS.ProcessEnv);

    expect(Number.isNaN(Date.parse(v.builtAt))).toBe(false);
  });
});
