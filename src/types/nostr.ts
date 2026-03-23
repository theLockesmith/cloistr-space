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
// Using string[][] for tag compatibility with NostrEvent
export interface ContactListEvent extends NostrEvent {
  kind: 33000;
}

// Contact tag types for parsing (used after extracting from event.tags)
export type ContactTagType = 'p' | 'np' | 'd';

export interface ParsedContactTag {
  type: 'p' | 'np';
  pubkey: string;
  relay?: string;
  petname?: string;
  timestamp?: string;
}

export interface ParsedDTag {
  type: 'd';
  identifier: string;
}
