/**
 * @fileoverview Emit dist/version.json so a deploy can be PROVEN, not assumed.
 *
 * The instrument this replaces: reading the `index-*.js` filename off the
 * served page. That cannot answer the question. The hash is content-derived, so
 * redeploying identical code produces an identical filename -- meaning "the
 * name did not change" covers both "the rollout did not happen" and "the
 * rollout happened and changed nothing". A pod restart is indistinguishable
 * from either.
 *
 * A commit SHA baked in at build time does answer it, because it is tied to the
 * artifact rather than to its contents.
 *
 * Served uncached without any nginx change: `.json` is absent from nginx.conf's
 * cached-asset regex (js|css|png|jpg|...), so version.json falls through to
 * `location /`, which sets `Cache-Control: no-cache, no-store, must-revalidate`
 * with `always`.
 */

import { execSync } from 'node:child_process';
import type { Plugin } from 'vite';

export interface BuildVersion {
  /** Full commit SHA, or "unknown". */
  commit: string;
  /** Branch or tag, or "unknown". */
  ref: string;
  /** CI pipeline id, or "local". */
  pipeline: string;
  /** ISO timestamp of the build. */
  builtAt: string;
}

/**
 * Read a value from CI, falling back to git, falling back to "unknown".
 *
 * "unknown" is deliberate and must never be replaced with something
 * plausible-looking. A probe comparing SHAs has to be able to tell "this build
 * does not know what it is" from "this build is the one you wanted" -- and a
 * fabricated fallback would make those two identical, which is the failure this
 * whole file exists to prevent.
 */
function gitOr(command: string, fallback = 'unknown'): string {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

export function resolveBuildVersion(env: NodeJS.ProcessEnv = process.env): BuildVersion {
  return {
    commit: env.CI_COMMIT_SHA || gitOr('git rev-parse HEAD'),
    ref: env.CI_COMMIT_REF_NAME || gitOr('git rev-parse --abbrev-ref HEAD'),
    pipeline: env.CI_PIPELINE_ID || 'local',
    builtAt: new Date().toISOString(),
  };
}

/**
 * Refuse to produce a deployable artifact that cannot identify itself.
 *
 * A bundle whose version.json says "unknown" makes the probe useless in exactly
 * the situation it exists for, and the failure would only surface at deploy
 * verification time -- long after the build looked fine. Failing here is louder
 * and cheaper.
 *
 * Only in CI. A local build with no git available is a nuisance, not a
 * deployable artifact, and blocking it would just make development worse.
 */
export function assertIdentified(
  version: BuildVersion,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env.CI && version.commit === 'unknown') {
    throw new Error(
      'Build refused: this bundle cannot identify itself (no CI_COMMIT_SHA and no git). ' +
        'A deployed artifact with an unknown commit cannot be verified after rollout.'
    );
  }
}

/** Vite plugin: writes the build's identity to dist/version.json. */
export function buildVersionPlugin(): Plugin {
  return {
    name: 'cloistr-build-version',
    apply: 'build',
    generateBundle() {
      const version = resolveBuildVersion();
      assertIdentified(version);

      this.emitFile({
        type: 'asset',
        // Fixed name on purpose. A hashed filename would be unfindable by a
        // probe that does not already know the build -- which is the thing the
        // probe is trying to determine.
        fileName: 'version.json',
        source: JSON.stringify(version, null, 2) + '\n',
      });
    },
  };
}
