/**
 * @fileoverview Tests for NIP-0A contact list parsing/building
 */

import { describe, it, expect } from 'vitest';
import {
  NIP0A_KIND,
  NIP0A_D_TAG,
  parseNip0aEvent,
  buildNip0aTags,
  buildNip0aContent,
  mergeNip0aEvents,
  getNip0aFilter,
  isContactTag,
  isValidPubkey,
  NIP02_KIND,
  parseKind3Event,
  getKind3Filter,
  countKind3Contacts,
} from './nip0a';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { ContactsCrdtState } from '@/types/contacts';

// Helper to create mock NDKEvent
function mockEvent(tags: string[][], created_at = 1700000000): Partial<NDKEvent> {
  return {
    tags,
    created_at,
    pubkey: 'a'.repeat(64),
    kind: NIP0A_KIND,
    content: '',
    id: 'test-event-id',
  };
}

describe('NIP0A_KIND', () => {
  it('should be 33000', () => {
    expect(NIP0A_KIND).toBe(33000);
  });
});

describe('NIP0A_D_TAG', () => {
  it('should be "contacts"', () => {
    expect(NIP0A_D_TAG).toBe('contacts');
  });
});

describe('parseNip0aEvent', () => {
  it('parses active contact tags', () => {
    const event = mockEvent([
      ['d', 'contacts'],
      ['p', 'b'.repeat(64), 'wss://relay.example.com', 'alice', '1699999999'],
    ]);

    const state = parseNip0aEvent(event as NDKEvent);

    expect(state.entries.size).toBe(1);
    const entry = state.entries.get('b'.repeat(64));
    expect(entry).toBeDefined();
    expect(entry?.pubkey).toBe('b'.repeat(64));
    expect(entry?.relay).toBe('wss://relay.example.com');
    expect(entry?.petname).toBe('alice');
    expect(entry?.timestamp).toBe(1699999999);
    expect(entry?.deleted).toBe(false);
  });

  it('parses tombstone (deleted) tags', () => {
    const event = mockEvent([
      ['d', 'contacts'],
      ['np', 'c'.repeat(64), '1699999999'],
    ]);

    const state = parseNip0aEvent(event as NDKEvent);

    expect(state.entries.size).toBe(1);
    const entry = state.entries.get('c'.repeat(64));
    expect(entry).toBeDefined();
    expect(entry?.deleted).toBe(true);
    expect(entry?.timestamp).toBe(1699999999);
  });

  it('handles missing optional fields', () => {
    const event = mockEvent([
      ['d', 'contacts'],
      ['p', 'd'.repeat(64)], // Only pubkey, no relay/petname/timestamp
    ]);

    const state = parseNip0aEvent(event as NDKEvent);

    const entry = state.entries.get('d'.repeat(64));
    expect(entry?.relay).toBeUndefined();
    expect(entry?.petname).toBeUndefined();
    expect(entry?.timestamp).toBe(1700000000); // Falls back to event created_at
  });

  it('newer tombstone wins over older contact', () => {
    const event = mockEvent([
      ['d', 'contacts'],
      ['p', 'e'.repeat(64), '', '', '1699999990'], // Active at time 990
      ['np', 'e'.repeat(64), '1699999999'], // Deleted at time 999
    ]);

    const state = parseNip0aEvent(event as NDKEvent);

    const entry = state.entries.get('e'.repeat(64));
    expect(entry?.deleted).toBe(true);
    expect(entry?.timestamp).toBe(1699999999);
  });

  it('newer contact wins over older tombstone', () => {
    const event = mockEvent([
      ['d', 'contacts'],
      ['np', 'f'.repeat(64), '1699999990'], // Deleted at time 990
      ['p', 'f'.repeat(64), '', '', '1699999999'], // Re-added at time 999
    ]);

    const state = parseNip0aEvent(event as NDKEvent);

    const entry = state.entries.get('f'.repeat(64));
    expect(entry?.deleted).toBe(false);
  });
});

describe('buildNip0aTags', () => {
  it('builds tags for active contacts', () => {
    const state: ContactsCrdtState = {
      entries: new Map([
        ['a'.repeat(64), {
          pubkey: 'a'.repeat(64),
          relay: 'wss://relay.example.com',
          petname: 'alice',
          timestamp: 1699999999,
          deleted: false,
        }],
      ]),
      version: 1,
      lastSync: 0,
      clientId: 'test',
      pendingChanges: [],
    };

    const tags = buildNip0aTags(state);

    expect(tags).toContainEqual(['d', 'contacts']);
    expect(tags).toContainEqual([
      'p',
      'a'.repeat(64),
      'wss://relay.example.com',
      'alice',
      '1699999999',
    ]);
  });

  it('builds tombstone tags for deleted contacts', () => {
    const state: ContactsCrdtState = {
      entries: new Map([
        ['b'.repeat(64), {
          pubkey: 'b'.repeat(64),
          timestamp: 1699999999,
          deleted: true,
        }],
      ]),
      version: 1,
      lastSync: 0,
      clientId: 'test',
      pendingChanges: [],
    };

    const tags = buildNip0aTags(state);

    expect(tags).toContainEqual(['d', 'contacts']);
    expect(tags).toContainEqual(['np', 'b'.repeat(64), '1699999999']);
  });
});

describe('buildNip0aContent', () => {
  it('returns JSON with metadata', () => {
    const state: ContactsCrdtState = {
      entries: new Map([
        ['a'.repeat(64), { pubkey: 'a'.repeat(64), timestamp: 0, deleted: false }],
        ['b'.repeat(64), { pubkey: 'b'.repeat(64), timestamp: 0, deleted: true }],
      ]),
      version: 5,
      lastSync: 0,
      clientId: 'my-client',
      pendingChanges: [],
    };

    const content = buildNip0aContent(state);
    const parsed = JSON.parse(content);

    expect(parsed.version).toBe(5);
    expect(parsed.count).toBe(1); // Only active contacts
    expect(parsed.clientId).toBe('my-client');
  });
});

describe('mergeNip0aEvents', () => {
  it('merges multiple events using LWW', () => {
    const event1 = mockEvent([
      ['d', 'contacts'],
      ['p', 'a'.repeat(64), '', '', '1699999990'],
    ], 1699999990);

    const event2 = mockEvent([
      ['d', 'contacts'],
      ['p', 'a'.repeat(64), 'wss://new.relay', 'updated', '1699999999'],
    ], 1699999999);

    const merged = mergeNip0aEvents([event1 as NDKEvent, event2 as NDKEvent]);

    const entry = merged.entries.get('a'.repeat(64));
    expect(entry?.relay).toBe('wss://new.relay');
    expect(entry?.petname).toBe('updated');
    expect(entry?.timestamp).toBe(1699999999);
  });

  it('keeps higher version', () => {
    const event1 = mockEvent([['d', 'contacts']], 100);
    const event2 = mockEvent([['d', 'contacts']], 200);

    const merged = mergeNip0aEvents([event1 as NDKEvent, event2 as NDKEvent]);

    expect(merged.version).toBe(200);
  });
});

describe('getNip0aFilter', () => {
  it('returns correct filter', () => {
    const pubkey = 'x'.repeat(64);
    const filter = getNip0aFilter(pubkey);

    expect(filter.kinds).toContain(33000);
    expect(filter.authors).toContain(pubkey);
    expect(filter['#d']).toContain('contacts');
  });
});

describe('isContactTag', () => {
  it('returns true for p tags with valid pubkey', () => {
    expect(isContactTag(['p', 'a'.repeat(64)])).toBe(true);
  });

  it('returns true for np tags with valid pubkey', () => {
    expect(isContactTag(['np', 'a'.repeat(64)])).toBe(true);
  });

  it('returns false for other tags', () => {
    expect(isContactTag(['e', 'a'.repeat(64)])).toBe(false);
    expect(isContactTag(['d', 'contacts'])).toBe(false);
  });

  it('returns false for invalid pubkey length', () => {
    expect(isContactTag(['p', 'short'])).toBe(false);
  });
});

describe('isValidPubkey', () => {
  it('returns true for valid 64-char hex', () => {
    expect(isValidPubkey('a'.repeat(64))).toBe(true);
    expect(isValidPubkey('0123456789abcdef'.repeat(4))).toBe(true);
  });

  it('returns false for invalid formats', () => {
    expect(isValidPubkey('short')).toBe(false);
    expect(isValidPubkey('g'.repeat(64))).toBe(false); // Invalid hex
    expect(isValidPubkey('')).toBe(false);
  });
});

// =============================================================================
// Kind:3 Legacy Import Tests
// =============================================================================

describe('NIP02_KIND', () => {
  it('should be 3', () => {
    expect(NIP02_KIND).toBe(3);
  });
});

describe('parseKind3Event', () => {
  it('parses kind:3 p tags into contacts', () => {
    const event = {
      ...mockEvent([
        ['p', 'a'.repeat(64), 'wss://relay.example.com', 'alice'],
        ['p', 'b'.repeat(64), 'wss://other.relay'],
        ['p', 'c'.repeat(64)],
      ], 1700000000),
      kind: 3,
    };

    const state = parseKind3Event(event as NDKEvent);

    expect(state.entries.size).toBe(3);

    const alice = state.entries.get('a'.repeat(64));
    expect(alice?.relay).toBe('wss://relay.example.com');
    expect(alice?.petname).toBe('alice');
    expect(alice?.timestamp).toBe(1700000000);
    expect(alice?.deleted).toBe(false);

    const b = state.entries.get('b'.repeat(64));
    expect(b?.relay).toBe('wss://other.relay');
    expect(b?.petname).toBeUndefined();

    const c = state.entries.get('c'.repeat(64));
    expect(c?.relay).toBeUndefined();
    expect(c?.petname).toBeUndefined();
  });

  it('ignores invalid pubkeys', () => {
    const event = {
      ...mockEvent([
        ['p', 'a'.repeat(64)], // Valid
        ['p', 'short'], // Invalid - too short
        ['p', 'g'.repeat(64)], // Invalid - not hex
      ], 1700000000),
      kind: 3,
    };

    const state = parseKind3Event(event as NDKEvent);

    expect(state.entries.size).toBe(1);
    expect(state.entries.has('a'.repeat(64))).toBe(true);
  });

  it('uses event created_at as timestamp for all entries', () => {
    const event = {
      ...mockEvent([
        ['p', 'a'.repeat(64)],
        ['p', 'b'.repeat(64)],
      ], 1699999999),
      kind: 3,
    };

    const state = parseKind3Event(event as NDKEvent);

    for (const entry of state.entries.values()) {
      expect(entry.timestamp).toBe(1699999999);
    }
  });
});

describe('getKind3Filter', () => {
  it('returns correct filter with limit 1', () => {
    const pubkey = 'x'.repeat(64);
    const filter = getKind3Filter(pubkey);

    expect(filter.kinds).toContain(3);
    expect(filter.authors).toContain(pubkey);
    expect(filter.limit).toBe(1);
  });
});

describe('countKind3Contacts', () => {
  it('counts valid p tags', () => {
    const event = mockEvent([
      ['p', 'a'.repeat(64)],
      ['p', 'b'.repeat(64)],
      ['p', 'c'.repeat(64)],
      ['e', 'event-id'], // Not a p tag
      ['p', 'short'], // Invalid pubkey
    ]);

    const count = countKind3Contacts(event as NDKEvent);
    expect(count).toBe(3);
  });
});
