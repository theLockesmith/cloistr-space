/**
 * The guard in publishContacts that refuses to publish a contact list carrying
 * nothing.
 *
 * It checked `tags.length === 0`, but buildNip0aTags always emits the
 * ['d', 'contacts'] identifier, so the length is never below 1 and the guard
 * could not fire. contactFilterShape.test.ts calls this guard "the other half
 * of the fix" for the 2026-08-24 follow-list wipe; until this test, that half
 * was a comment, not a behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContactsSyncService } from './contactsSync';
import { buildNip0aTags } from './nip0a';
import { useContactsStore } from '@/stores/contactsStore';
import type { NdkService } from '@/services/nostr';

function fakeNdkService(sign: () => Promise<void>) {
  return {
    getNdk: () => ({ signer: { sign } }),
  } as unknown as NdkService;
}

describe('publishContacts empty-list guard', () => {
  beforeEach(() => {
    useContactsStore.setState(useContactsStore.getInitialState());
  });

  it('an empty store still builds a d tag, so "no tags" was the wrong test', () => {
    expect(buildNip0aTags(useContactsStore.getState().crdt)).toEqual([['d', 'contacts']]);
  });

  it('refuses to publish when the list has no follows and no tombstones', async () => {
    const sign = vi.fn(async () => {});
    const svc = new ContactsSyncService(fakeNdkService(sign));

    await expect(svc.publishContacts()).resolves.toBe(false);
    expect(sign).not.toHaveBeenCalled();
  });
});
