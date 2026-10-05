/**
 * Two ways a contact list could lose entries, found in review of the headless
 * contacts work (2026-10-05).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseNip0aEvent, mergeNip0aEvents } from './nip0a';
import { ContactsSyncService } from './contactsSync';
import { useContactsStore } from '@/stores/contactsStore';
import type { NdkService } from '@/services/nostr';

const BOB = 'b0'.repeat(32);

describe('a malformed entry timestamp', () => {
  it('falls back to the event time instead of becoming NaN', () => {
    // NaN loses every comparison, so a NaN entry could never be replaced by a
    // later follow or unfollow, and stampAfter would copy NaN forward.
    const state = parseNip0aEvent({
      created_at: 500,
      tags: [['p', BOB, '', '', 'not-a-number'], ['np', 'c0'.repeat(32), 'garbage']],
    });
    expect(state.entries.get(BOB)?.timestamp).toBe(500);
    expect(state.entries.get('c0'.repeat(32))?.timestamp).toBe(500);
  });

  it('lets a later valid entry win over a malformed one', () => {
    const merged = mergeNip0aEvents([
      { created_at: 500, tags: [['p', BOB, '', '', 'oops']] },
      { created_at: 600, tags: [['np', BOB, '600']] },
    ]);
    expect(merged.entries.get(BOB)?.deleted).toBe(true);
  });
});

describe('sync when the relay returns nothing', () => {
  beforeEach(() => {
    useContactsStore.setState(useContactsStore.getInitialState());
  });

  it('does not republish an unchanged local list over whatever the relay really has', async () => {
    // An empty answer may be a relay that did not answer. Publishing this
    // device's copy then replaces a fuller list held elsewhere.
    useContactsStore.getState().mergeCrdt({
      entries: new Map([[BOB, { pubkey: BOB, timestamp: 100, deleted: false }]]),
      version: 1, lastSync: 0, clientId: 'x', pendingChanges: [],
    });
    useContactsStore.getState().markSynced();

    const sign = vi.fn();
    const publish = vi.fn();
    const svc = new ContactsSyncService({
      getNdk: () => ({ signer: { sign, user: async () => ({ pubkey: 'aa'.repeat(32) }) } }),
      fetchFromOwnRelays: async () => new Set(),
      createEvent: () => null,
      publish,
    } as unknown as NdkService);

    const result = await svc.sync('aa'.repeat(32));

    expect(result.success).toBe(true);
    expect(result.published).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });
});
