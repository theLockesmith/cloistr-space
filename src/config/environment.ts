// Environment configuration
// Values come from Vite's import.meta.env (prefixed with VITE_)

export const config = {
  // Primary relay
  relayUrl: import.meta.env.VITE_RELAY_URL ?? 'wss://relay.cloistr.xyz',

  // Cloistr services
  signerUrl: import.meta.env.VITE_SIGNER_URL ?? 'https://signer.cloistr.xyz',
  driveApiUrl: import.meta.env.VITE_DRIVE_API ?? 'https://drive-api.cloistr.xyz',
  blossomApiUrl: import.meta.env.VITE_BLOSSOM_API ?? 'https://files.cloistr.xyz',
  discoveryApiUrl: import.meta.env.VITE_DISCOVERY_API ?? 'https://discover.cloistr.xyz/api',

  // Feature flags
  enableDevTools: import.meta.env.DEV,
} as const;

// Relay list for outbox model
export const defaultRelays = [
  'wss://relay.cloistr.xyz',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
] as const;
