/**
 * Service addresses, resolved at startup so one image serves production and
 * staging.
 *
 * Order, highest first: runtime configuration the container writes to
 * /config.js (window.__CLOISTR_CONFIG__), then the build-time VITE_* variable,
 * then the production default. Through @cloistr/collab-common's shared reader,
 * so every Cloistr frontend resolves the same way. See that package's
 * docs/runtime-config-adoption.md.
 *
 * With no runtime configuration every value is production, which is what makes
 * adopting this a non-change for the live service. environment.test.ts pins it.
 */

import { getRuntimeConfig, getServiceConfig } from '@cloistr/collab-common/config';

const service = getServiceConfig();
const runtime = getRuntimeConfig();

/** A per-service override from runtime config, ignoring blanks. */
function override(id: string): string | undefined {
  const value = service.services[id];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export const config = {
  environment: service.environment,

  // Primary relay
  relayUrl: service.relayUrl,

  // Cloistr services
  signerUrl: service.signerUrl,

  // The reader's own file-host default is a public third-party host, not ours,
  // so Space keeps its own production fallback when nothing is configured.
  blossomApiUrl:
    runtime.blossomUrl ||
    import.meta.env.VITE_BLOSSOM_URL ||
    import.meta.env.VITE_BLOSSOM_API ||
    'https://files.cloistr.xyz',

  discoveryApiUrl: import.meta.env.VITE_DISCOVERY_API ?? `${service.discoveryUrl.replace(/\/$/, '')}/api`,

  // Drive/Stash is served at stash.cloistr.xyz. drive-api.cloistr.xyz has never
  // existed -- it is NXDOMAIN -- so this default produced a NetworkError on
  // every drive call rather than a clean failure, which is why the activity
  // dashboard's file widgets read as "no files" instead of as an error.
  // Verified 2026-08-27: stash.cloistr.xyz answers 200 on /health, /api/files
  // and /api/quota with the shapes the DriveClient mappers expect.
  // Keyed 'files' to match the shared nav catalog's id for Stash.
  driveApiUrl: override('files') ?? import.meta.env.VITE_DRIVE_API ?? 'https://stash.cloistr.xyz',

  docsApiUrl: override('docs-api') ?? import.meta.env.VITE_DOCS_API ?? 'https://docs-api.cloistr.xyz',

  // Other apps Space hands off to.
  tasksUrl: override('tasks') ?? 'https://tasks.cloistr.xyz',

  /** This app's own public URL, for links it generates about itself. */
  appUrl: service.appUrl ?? (typeof window !== 'undefined' ? window.location.origin : 'https://space.cloistr.xyz'),

  // Thread handoff granters (comma-separated hex pubkeys)
  threadGranters: ((import.meta.env.VITE_THREAD_GRANTERS as string | undefined) ?? '3331f3b0599a6381d65c9b90b85516161dc303d28a9111fafbb64c74d501fae4')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Feature flags
  enableDevTools: import.meta.env.DEV,
} as const;

// Relay list - the configured relay only for now.
// External relays can be added later via user preferences.
export const defaultRelays = [config.relayUrl] as const;
