/**
 * @fileoverview Tests for the kind:3 auto-import precondition.
 *
 * This is the gate on a DESTRUCTIVE path. importFromKind3 merges under LWW and
 * then publishes a new kind:33000, and NIP-0A records unfollows as tombstones,
 * so importing while the real list is merely unloaded can resurrect a contact
 * the user deliberately removed and republish it under their own key.
 *
 * The whole point of these tests is that "the store looks empty" is not
 * sufficient evidence to import. Only a COMPLETED sync that found nothing is.
 */

import { describe, it, expect } from 'vitest';
import { autoImportState } from './useContactsSync';
import type { SyncResult } from './contactsSync';

function result(over: Partial<SyncResult> = {}): SyncResult {
  return {
    success: true,
    remoteEventsFound: 0,
    conflictsResolved: 0,
    published: false,
    ...over,
  };
}

describe('autoImportState', () => {
  it('is synced-empty only when a successful sync found nothing', () => {
    // The one safe case: relays answered, and this user genuinely has no
    // NIP-0A list, so there are no tombstones to trample.
    expect(autoImportState(result({ remoteEventsFound: 0 }), true)).toBe('synced-empty');
  });

  it('is synced-populated when the user already has a NIP-0A list', () => {
    // Never import over an existing list -- kind:3 is the legacy source and
    // kind:33000 is authoritative once it exists.
    expect(autoImportState(result({ remoteEventsFound: 1 }), true)).toBe('synced-populated');
  });

  it('is not-synced before any sync has completed', () => {
    // Absence of a result proves nothing about the user's contacts.
    expect(autoImportState(null, true)).toBe('not-synced');
  });

  it('is not-synced when the sync failed, even though it reports zero events found', () => {
    // The critical case. A failed sync also carries remoteEventsFound: 0, so
    // anything keying off the count alone would read this as "no contacts" and
    // import. It means "we could not look", not "there is nothing there".
    expect(
      autoImportState(result({ success: false, error: 'Sync failed' }), true)
    ).toBe('not-synced');
  });

  it('is not-synced when a sync is already in progress', () => {
    // contactsSync returns success:false with this error rather than queueing,
    // so it lands in the same bucket: no conclusion available yet.
    expect(
      autoImportState(result({ success: false, error: 'Sync already in progress' }), true)
    ).toBe('not-synced');
  });

  it('is not-synced when not ready, regardless of what the last result says', () => {
    // isReady carries isConnected. Offline, NDK's fetchEvents resolves empty
    // exactly as it does when a relay answers with nothing, so a stale
    // success from a previous connection must not authorise an import now.
    expect(autoImportState(result({ remoteEventsFound: 0 }), false)).toBe('not-synced');
    expect(autoImportState(result({ remoteEventsFound: 5 }), false)).toBe('not-synced');
  });

  it('never returns synced-empty for any unsuccessful result', () => {
    // Property check over the shapes that could plausibly arise, since
    // synced-empty is the only value that unlocks a publish.
    const unsafe: SyncResult[] = [
      result({ success: false }),
      result({ success: false, remoteEventsFound: 0 }),
      result({ success: false, remoteEventsFound: 3 }),
      result({ success: false, error: 'network' }),
    ];

    for (const r of unsafe) {
      expect(autoImportState(r, true)).not.toBe('synced-empty');
    }
  });
});
