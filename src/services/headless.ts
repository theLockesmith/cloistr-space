/**
 * Headless interfaces for Space operations without React.
 *
 * A headless caller (CLI, test, fleet script) provides its own implementation
 * of NostrClient. The React hooks provide one via NDK.
 *
 * Compatible with SignerInterface from @cloistr/auth — a headless consumer can
 * satisfy these interfaces with that type. Defined locally so the pure modules
 * have no React transitive dependency (audit fix #1 will add @cloistr/auth/core
 * for this; until then, importing @cloistr/auth pulls React).
 */

export interface NostrEventLike {
  id: string;
  pubkey: string;
  created_at?: number;
  kind?: number;
  tags: string[][];
  content: string;
}

export interface SignedNostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface NostrClient {
  getPublicKey(): Promise<string>;
  signAndPublish(template: { kind: number; content: string; tags: string[][] }): Promise<number>;
  publishSigned(event: SignedNostrEvent): Promise<number>;
  fetch(filter: Record<string, unknown>): Promise<NostrEventLike[]>;
}
