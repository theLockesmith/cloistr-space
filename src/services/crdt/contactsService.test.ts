import { describe, it, expect } from 'vitest';
import type { Event, UnsignedEvent } from 'nostr-tools';
import type { SignerInterface, RelayClient } from '../headless';
import { NIP0A_KIND } from './nip0a';
import {
  readContacts,
  followContact,
  unfollowContact,
  publishContactState,
} from './contactsService';
import type { ContactsCrdtState } from '@/types/contacts';

const ME = 'aa'.repeat(32);
const ALICE = 'a1'.repeat(32);
const BOB = 'b0'.repeat(32);
const MALLORY = 'ee'.repeat(32);

const signer: SignerInterface = {
  getPublicKey: async () => ME,
  signEvent: async (u: UnsignedEvent): Promise<Event> => ({ ...u, id: 'ff'.repeat(32), sig: 'cc'.repeat(64) }),
  encrypt: async () => '',
  decrypt: async () => '',
};

function listEvent(pubkey: string, tags: string[][], created_at = 1000): Event {
  return { kind: NIP0A_KIND, pubkey, created_at, content: '', tags: [['d', 'contacts'], ...tags], id: '11'.repeat(32), sig: '22'.repeat(64) };
}

function relayWith(events: Event[] | Error): RelayClient & { published: Event[] } {
  const published: Event[] = [];
  return {
    published,
    publish: async (e) => (published.push(e), 1),
    fetch: async () => {
      if (events instanceof Error) throw events;
      return events;
    },
  };
}

const entryTags = (e: Event) => e.tags.filter((t) => t[0] === 'p' || t[0] === 'np');

describe('readContacts', () => {
  it('reports a failed read as a failure, not as an empty list', async () => {
    expect(await readContacts(relayWith(new Error('offline')), ME)).toEqual({ ok: false });
  });

  it('distinguishes "no list yet" from a list', async () => {
    const none = await readContacts(relayWith([]), ME);
    expect(none.ok && none.found).toBe(false);

    const some = await readContacts(relayWith([listEvent(ME, [['p', ALICE, '', '', '900']])]), ME);
    expect(some.ok && some.found).toBe(true);
    expect(some.ok && some.found && [...some.state.entries.keys()]).toEqual([ALICE]);
  });

  it('ignores lists signed by anyone else', async () => {
    const r = await readContacts(relayWith([listEvent(MALLORY, [['p', MALLORY, '', '', '900']])]), ME);
    expect(r.ok && r.found).toBe(false);
  });
});

describe('followContact', () => {
  it('adds the follow and keeps every existing entry, tombstones included', async () => {
    const relay = relayWith([listEvent(ME, [['p', ALICE, '', '', '900'], ['np', MALLORY, '950']])]);
    const result = await followContact(signer, relay, ME, BOB, { petname: 'bob' });

    expect(result.ok).toBe(true);
    const tags = entryTags(relay.published[0]);
    expect(relay.published[0].kind).toBe(NIP0A_KIND);
    expect(tags).toContainEqual(['p', ALICE, '', '', '900']);
    expect(tags).toContainEqual(['np', MALLORY, '950']);
    expect(tags.find((t) => t[1] === BOB)?.slice(0, 4)).toEqual(['p', BOB, '', 'bob']);
  });

  it('stamps the change later than the entry it replaces, so it wins the merge', async () => {
    const future = String(Math.floor(Date.now() / 1000) + 10_000);
    const relay = relayWith([listEvent(ME, [['np', BOB, future]])]);
    await followContact(signer, relay, ME, BOB);

    const bob = entryTags(relay.published[0]).find((t) => t[1] === BOB)!;
    expect(bob[0]).toBe('p');
    expect(Number(bob[4])).toBeGreaterThan(Number(future));
  });

  it('publishes nothing when the read failed', async () => {
    const relay = relayWith(new Error('offline'));
    expect(await followContact(signer, relay, ME, BOB)).toEqual({ ok: false, reason: 'read-failed' });
    expect(relay.published).toHaveLength(0);
  });

  it('will not create a list from nothing unless asked', async () => {
    // A read that found nothing may be a relay that did not answer. Publishing
    // a one-entry list then replaces the real one -- the 2026-08-24 shape.
    const relay = relayWith([]);
    expect(await followContact(signer, relay, ME, BOB)).toEqual({ ok: false, reason: 'no-list' });
    expect(relay.published).toHaveLength(0);

    expect((await followContact(signer, relay, ME, BOB, { createIfMissing: true })).ok).toBe(true);
    expect(entryTags(relay.published[0]).map((t) => t[1])).toEqual([BOB]);
  });
});

describe('unfollowContact', () => {
  it('writes a tombstone and keeps everyone else', async () => {
    const relay = relayWith([listEvent(ME, [['p', ALICE, '', '', '900'], ['p', BOB, '', '', '900']])]);
    await unfollowContact(signer, relay, ME, BOB);

    const tags = entryTags(relay.published[0]);
    expect(tags).toContainEqual(['p', ALICE, '', '', '900']);
    expect(tags.find((t) => t[1] === BOB)?.[0]).toBe('np');
  });

  it('refuses when there is no list to edit', async () => {
    const relay = relayWith([]);
    expect(await unfollowContact(signer, relay, ME, BOB)).toEqual({ ok: false, reason: 'no-list' });
    expect(relay.published).toHaveLength(0);
  });
});

describe('publishContactState', () => {
  it('never publishes a list with no entries', async () => {
    const relay = relayWith([]);
    const empty: ContactsCrdtState = { entries: new Map(), version: 0, lastSync: 0, clientId: 't', pendingChanges: [] };
    await expect(publishContactState(signer, relay, empty)).resolves.toBeNull();
    expect(relay.published).toHaveLength(0);
  });
});
