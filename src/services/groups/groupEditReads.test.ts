/**
 * @fileoverview Sweep #7: a project edit must never be built from a read that
 * found nothing.
 *
 * kind:39001 (admins), 39002 (members) and 39000 (metadata) are addressable:
 * each publish REPLACES the whole event. So an edit built on an empty read
 * does not add to the list, it replaces it.
 *
 *  1. Reading members or admins treated "no events at all" as "an empty
 *     list", so adding one person published a list of one, removing everyone
 *     else, the owner included. A project being edited always has a 39000;
 *     finding none means the read did not reach it.
 *  2. Editing the name rebuilt 39000 from the edit alone, dropping the
 *     public/private and open/closed tags (and anything else on it).
 */

import { describe, it, expect } from 'vitest';
import type { Event, UnsignedEvent } from 'nostr-tools';
import type { SignerInterface, RelayClient } from '../headless';
import { GROUP_METADATA_KIND, GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND } from '@/types/groups';
import { addGroupMember, setGroupPermissions, updateGroupMetadata, readGroupMembers } from './groupService';

const OWNER = '1234567890abcdef'.repeat(4);
const BOB = 'bb'.repeat(32);
const CAROL = 'cc'.repeat(32);
const GROUP = `my-project-${OWNER.slice(0, 16)}-0a0b0c0d`;

const signer: SignerInterface = {
  getPublicKey: async () => OWNER,
  signEvent: async (u: UnsignedEvent): Promise<Event> => ({ ...u, id: 'ee'.repeat(32), sig: 'ff'.repeat(64) }),
  encrypt: async () => '',
  decrypt: async () => '',
};

function relayWith(events: Partial<Event>[]): RelayClient & { published: Event[] } {
  const published: Event[] = [];
  return {
    published,
    publish: async (e: Event) => {
      published.push(e);
      return 1;
    },
    fetch: async (filter: Record<string, unknown>) =>
      events.filter((e) => (filter.kinds as number[]).includes(e.kind!)) as Event[],
  };
}

let n = 0;
const ev = (kind: number, tags: string[][], pubkey = OWNER, created_at = 1000): Partial<Event> => ({
  id: (++n).toString(16).padStart(64, '0'),
  kind,
  pubkey,
  created_at,
  content: '',
  tags: [['d', GROUP], ...tags],
});

const metadata = ev(GROUP_METADATA_KIND, [['name', 'My project'], ['private'], ['closed'], ['about', 'old']]);
const admins = ev(GROUP_ADMINS_KIND, [['p', OWNER, 'add-user', 'remove-user', 'edit-metadata']]);
const members = ev(GROUP_MEMBERS_KIND, [['p', OWNER], ['p', CAROL]]);
const pTags = (e: Event) => e.tags.filter((t) => t[0] === 'p').map((t) => t[1]);

describe('member edits', () => {
  it('a read that found no project publishes nothing', async () => {
    const relay = relayWith([]);
    const result = await addGroupMember(signer, relay, GROUP, BOB);
    expect(result.ok).toBe(false);
    expect(relay.published).toEqual([]);
    expect((await readGroupMembers(relay, GROUP)).ok).toBe(false);
  });

  it('a member list read without the project itself publishes nothing', async () => {
    // Without 39000 nobody can tell whose list this is, so it is no base for an edit.
    const relay = relayWith([members]);
    const result = await addGroupMember(signer, relay, GROUP, BOB);
    expect(result.ok).toBe(false);
    expect(relay.published).toEqual([]);
  });

  it('a project whose member list was not found publishes nothing', async () => {
    const relay = relayWith([metadata, admins]);
    const result = await addGroupMember(signer, relay, GROUP, BOB);
    expect(result.ok).toBe(false);
    expect(relay.published).toEqual([]);
  });

  it('a full read adds to the list, keeping everyone', async () => {
    const relay = relayWith([metadata, admins, members]);
    const result = await addGroupMember(signer, relay, GROUP, BOB);
    expect(result.ok).toBe(true);
    expect(pTags(relay.published[0]).sort()).toEqual([OWNER, CAROL, BOB].sort());
  });
});

describe('permission edits', () => {
  it('a read that found no project publishes nothing', async () => {
    const relay = relayWith([]);
    const result = await setGroupPermissions(signer, relay, GROUP, BOB, ['add-user']);
    expect(result.ok).toBe(false);
    expect(relay.published).toEqual([]);
  });

  it('a project whose admin list was not found publishes nothing', async () => {
    const relay = relayWith([metadata]);
    const result = await setGroupPermissions(signer, relay, GROUP, BOB, ['add-user']);
    expect(result.ok).toBe(false);
    expect(relay.published).toEqual([]);
  });

  it('a full read keeps the owner as admin', async () => {
    const relay = relayWith([metadata, admins]);
    const result = await setGroupPermissions(signer, relay, GROUP, BOB, ['add-user']);
    expect(result.ok).toBe(true);
    expect(pTags(relay.published[0]).sort()).toEqual([OWNER, BOB].sort());
  });
});

describe('metadata edits', () => {
  it('keep private/closed and every other tag they do not change', async () => {
    const relay = relayWith([metadata]);
    const result = await updateGroupMetadata(signer, relay, GROUP, { name: 'Renamed', about: 'new' });
    expect(result.ok).toBe(true);
    const tags = relay.published[0].tags;
    expect(tags).toContainEqual(['d', GROUP]);
    expect(tags).toContainEqual(['name', 'Renamed']);
    expect(tags).toContainEqual(['about', 'new']);
    expect(tags).toContainEqual(['private']);
    expect(tags).toContainEqual(['closed']);
    expect(tags.filter((t) => t[0] === 'name')).toHaveLength(1);
    expect(tags.filter((t) => t[0] === 'about')).toHaveLength(1);
  });

  it('a read that found no metadata publishes nothing', async () => {
    const relay = relayWith([]);
    const result = await updateGroupMetadata(signer, relay, GROUP, { name: 'Renamed' });
    expect(result.ok).toBe(false);
    expect(relay.published).toEqual([]);
  });

  it('a metadata event from someone who may not edit is not the base', async () => {
    const forged = ev(GROUP_METADATA_KIND, [['name', 'Forged'], ['public'], ['open']], BOB, 2000);
    const relay = relayWith([metadata, forged]);
    await updateGroupMetadata(signer, relay, GROUP, { name: 'Renamed' });
    const tags = relay.published[0].tags;
    expect(tags).toContainEqual(['private']);
    expect(tags).not.toContainEqual(['public']);
  });
});
