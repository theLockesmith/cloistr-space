/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RELAY_URL: string;
  readonly VITE_SIGNER_URL: string;
  readonly VITE_DRIVE_API: string;
  readonly VITE_BLOSSOM_API: string;
  readonly VITE_DISCOVERY_API: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
