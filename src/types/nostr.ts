import type { Event, Filter } from 'nostr-tools';

export type NostrEvent = Event;
export type NostrFilter = Filter;

export interface RelayConnection {
  url: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  latency?: number;
}

export interface Subscription {
  id: string;
  filters: NostrFilter[];
  onEvent: (event: NostrEvent) => void;
  onEose?: () => void;
}

// NIP-0A Contact List Event (Kind 33000)
export interface ContactListEvent extends NostrEvent {
  kind: 33000;
  tags: ContactTag[];
}

export type ContactTag =
  | ['p', string, string?, string?, string?]  // pubkey, relay?, petname?, timestamp
  | ['np', string, string?, string?, string?] // removed pubkey (tombstone)
  | ['d', string];                             // client identifier
