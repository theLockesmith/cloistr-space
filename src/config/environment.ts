// Environment configuration
// Values come from Vite's import.meta.env (prefixed with VITE_)

export const config = {
  // Primary relay
  relayUrl: import.meta.env.VITE_RELAY_URL ?? 'wss://relay.cloistr.xyz',

  // Cloistr services
  signerUrl: import.meta.env.VITE_SIGNER_URL ?? 'https://signer.cloistr.xyz',
  // Drive/Stash is served at stash.cloistr.xyz. drive-api.cloistr.xyz has never
  // existed -- it is NXDOMAIN -- so this default produced a NetworkError on
  // every drive call rather than a clean failure, which is why the activity
  // dashboard's file widgets read as "no files" instead of as an error.
  // Verified 2026-08-27: stash.cloistr.xyz answers 200 on /health, /api/files
  // and /api/quota with the shapes the DriveClient mappers expect.
  driveApiUrl: import.meta.env.VITE_DRIVE_API ?? 'https://stash.cloistr.xyz',
  blossomApiUrl: import.meta.env.VITE_BLOSSOM_API ?? 'https://files.cloistr.xyz',
  discoveryApiUrl: import.meta.env.VITE_DISCOVERY_API ?? 'https://discover.cloistr.xyz/api',

  // Feature flags
  enableDevTools: import.meta.env.DEV,
} as const;

// Relay list - cloistr relay only for now
// External relays can be added later via user preferences
export const defaultRelays = [
  'wss://relay.cloistr.xyz',
] as const;
