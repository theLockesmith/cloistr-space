/**
 * @fileoverview NIP-0A Contact List CRDT implementation
 *
 * NIP-0A defines a synchronized contact list using kind:33000 addressable events
 * with LWW-Element-Set CRDT semantics for conflict resolution.
 *
 * Event structure:
 * - Kind: 33000 (addressable/replaceable)
 * - Tags:
 *   - ["d", "contacts"] - identifier for this addressable event
 *   - ["p", pubkey, relay?, petname?, timestamp] - active contact
 *   - ["np", pubkey, timestamp] - tombstone (deleted contact)
 */

import type { ContactEntry, ContactsCrdtState } from '@/types/contacts';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

/** Kind for NIP-0A contact list events */
export const NIP0A_KIND = 33000;

/** D-tag identifier for contact list */
export const NIP0A_D_TAG = 'contacts';

/**
 * Parse a NIP-0A kind:33000 event into ContactsCrdtState
 */
export function parseNip0aEvent(event: NDKEvent): ContactsCrdtState {
  const entries = new Map<string, ContactEntry>();

  for (const tag of event.tags) {
    if (tag[0] === 'p' && tag[1]) {
      // Active contact: ["p", pubkey, relay?, petname?, timestamp?]
      const pubkey = tag[1];
      const relay = tag[2] || undefined;
      const petname = tag[3] || undefined;
      const timestamp = tag[4] ? parseInt(tag[4], 10) : event.created_at ?? 0;

      entries.set(pubkey, {
        pubkey,
        relay,
        petname,
        timestamp,
        deleted: false,
      });
    } else if (tag[0] === 'np' && tag[1]) {
      // Tombstone (deleted): ["np", pubkey, timestamp?]
      const pubkey = tag[1];
      const timestamp = tag[2] ? parseInt(tag[2], 10) : event.created_at ?? 0;

      // Only set tombstone if it's newer than existing entry
      const existing = entries.get(pubkey);
      if (!existing || timestamp > existing.timestamp) {
        entries.set(pubkey, {
          pubkey,
          timestamp,
          deleted: true,
        });
      }
    }
  }

  return {
    entries,
    version: event.created_at ?? 0,
    lastSync: Math.floor(Date.now() / 1000),
    clientId: 'remote', // Remote state doesn't have a client ID
    pendingChanges: [],
  };
}

/**
 * Build NIP-0A event tags from CRDT state
 * Returns the tags array for a kind:33000 event
 */
export function buildNip0aTags(state: ContactsCrdtState): string[][] {
  const tags: string[][] = [['d', NIP0A_D_TAG]];

  for (const [pubkey, entry] of state.entries) {
    if (entry.deleted) {
      // Tombstone tag: ["np", pubkey, timestamp]
      tags.push(['np', pubkey, entry.timestamp.toString()]);
    } else {
      // Active contact tag: ["p", pubkey, relay, petname, timestamp]
      const tag = ['p', pubkey];
      tag.push(entry.relay ?? '');
      tag.push(entry.petname ?? '');
      tag.push(entry.timestamp.toString());
      tags.push(tag);
    }
  }

  return tags;
}

/**
 * Build content for NIP-0A event
 * Content is optional but can include metadata
 */
export function buildNip0aContent(state: ContactsCrdtState): string {
  // Content is optional - we include minimal metadata
  const activeCount = Array.from(state.entries.values()).filter(e => !e.deleted).length;
  return JSON.stringify({
    version: state.version,
    count: activeCount,
    clientId: state.clientId,
  });
}

/**
 * Merge multiple NIP-0A events into a single CRDT state
 * Uses LWW (Last-Write-Wins) semantics based on entry timestamps
 */
export function mergeNip0aEvents(events: NDKEvent[]): ContactsCrdtState {
  const merged: ContactsCrdtState = {
    entries: new Map(),
    version: 0,
    lastSync: Math.floor(Date.now() / 1000),
    clientId: 'merged',
    pendingChanges: [],
  };

  for (const event of events) {
    const eventState = parseNip0aEvent(event);

    // Track highest version
    if (eventState.version > merged.version) {
      merged.version = eventState.version;
    }

    // Merge entries using LWW
    for (const [pubkey, entry] of eventState.entries) {
      const existing = merged.entries.get(pubkey);
      if (!existing || entry.timestamp > existing.timestamp) {
        merged.entries.set(pubkey, entry);
      }
    }
  }

  return merged;
}

/**
 * Get filter for fetching NIP-0A events for a pubkey
 */
export function getNip0aFilter(pubkey: string) {
  return {
    kinds: [NIP0A_KIND],
    authors: [pubkey],
    '#d': [NIP0A_D_TAG],
  };
}

/**
 * Check if a tag is a valid contact entry tag
 */
export function isContactTag(tag: string[]): boolean {
  return (tag[0] === 'p' || tag[0] === 'np') && typeof tag[1] === 'string' && tag[1].length === 64;
}

/**
 * Validate a pubkey format (64 hex chars)
 */
export function isValidPubkey(pubkey: string): boolean {
  return /^[0-9a-f]{64}$/i.test(pubkey);
}

// =============================================================================
// NIP-02 Kind:3 Legacy Import
// =============================================================================

/** Kind for NIP-02 legacy contact list events */
export const NIP02_KIND = 3;

/**
 * Parse a NIP-02 kind:3 event into ContactsCrdtState
 * Kind:3 has no per-entry timestamps, so we use the event's created_at
 *
 * NIP-02 format: ["p", pubkey, relay?, petname?]
 */
export function parseKind3Event(event: NDKEvent): ContactsCrdtState {
  const entries = new Map<string, ContactEntry>();
  const timestamp = event.created_at ?? Math.floor(Date.now() / 1000);

  for (const tag of event.tags) {
    if (tag[0] === 'p' && tag[1] && isValidPubkey(tag[1])) {
      const pubkey = tag[1];
      const relay = tag[2] || undefined;
      const petname = tag[3] || undefined;

      entries.set(pubkey, {
        pubkey,
        relay,
        petname,
        timestamp,
        deleted: false,
      });
    }
  }

  return {
    entries,
    version: timestamp,
    lastSync: Math.floor(Date.now() / 1000),
    clientId: 'kind3-import',
    pendingChanges: [],
  };
}

/**
 * Get filter for fetching kind:3 events for a pubkey
 */
export function getKind3Filter(pubkey: string) {
  return {
    kinds: [NIP02_KIND],
    authors: [pubkey],
    limit: 1, // Only need the latest
  };
}

/**
 * Count contacts in a kind:3 event without full parsing
 */
export function countKind3Contacts(event: NDKEvent): number {
  return event.tags.filter(
    (tag) => tag[0] === 'p' && tag[1] && isValidPubkey(tag[1])
  ).length;
}
