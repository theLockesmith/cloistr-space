import { describe, it, expect } from 'vitest';
import type { SignerInterface, RelayClient } from '../headless';
import {
  GROUP_METADATA_KIND,
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  GROUP_JOIN_REQUEST_KIND,
  GROUP_LEAVE_REQUEST_KIND,
} from '@/types/groups';
import type { Event, UnsignedEvent } from 'nostr-tools';

const TEST_PUBKEY = 'aa'.repeat(32);

function createMockSigner(): SignerInterface {
  return {
    getPublicKey: async () => TEST_PUBKEY,
    signEvent: async (unsigned: UnsignedEvent): Promise<Event> => ({
      ...unsigned,
      id: 'bb'.repeat(32),
      sig: 'cc'.repeat(64),
    }),
    encrypt: async () => '',
    decrypt: async () => '',
  };
}

function createMockRelay(): RelayClient & { published: Event[] } {
  const published: Event[] = [];
  return {
    published,
    publish: async (event: Event) => {
      published.push(event);
      return 1;
    },
    fetch: async () => [],
  };
}

describe('groupService', () => {
  describe('joinGroup', () => {
    it('publishes a kind:9021 event with the group id', async () => {
      const { joinGroup } = await import('./groupService');
      const signer = createMockSigner();
      const relay = createMockRelay();

      await joinGroup(signer, relay, 'test-group', 'please let me in');

      expect(relay.published).toHaveLength(1);
      expect(relay.published[0].kind).toBe(GROUP_JOIN_REQUEST_KIND);
      expect(relay.published[0].content).toBe('please let me in');
      expect(relay.published[0].tags).toEqual([['h', 'test-group']]);
    });
  });

  describe('when no relay accepts', () => {
    it('joinGroup throws rather than reporting a sent request', async () => {
      // The UI adapter used to report a constant 1 here, so a join nobody
      // received looked identical to a sent one.
      const { joinGroup } = await import('./groupService');
      const relay = { ...createMockRelay(), publish: async () => 0 };

      await expect(joinGroup(createMockSigner(), relay, 'test-group')).rejects.toThrow(
        /No relay accepted/,
      );
    });
  });

  describe('leaveGroup', () => {
    it('publishes a kind:9022 event', async () => {
      const { leaveGroup } = await import('./groupService');
      const signer = createMockSigner();
      const relay = createMockRelay();

      await leaveGroup(signer, relay, 'test-group');

      expect(relay.published).toHaveLength(1);
      expect(relay.published[0].kind).toBe(GROUP_LEAVE_REQUEST_KIND);
      expect(relay.published[0].tags).toEqual([['h', 'test-group']]);
    });
  });

  describe('createGroup', () => {
    it('publishes metadata, admins, and members events', async () => {
      const { createGroup } = await import('./groupService');
      const signer = createMockSigner();
      const relay = createMockRelay();

      const groupId = await createGroup(signer, relay, {
        name: 'Test Group',
        description: 'A test group',
      });

      expect(groupId).toContain(TEST_PUBKEY.slice(0, 16));
      expect(relay.published).toHaveLength(3);
      expect(relay.published[0].kind).toBe(GROUP_METADATA_KIND);
      expect(relay.published[1].kind).toBe(GROUP_ADMINS_KIND);
      expect(relay.published[2].kind).toBe(GROUP_MEMBERS_KIND);
    });

    it('includes the creator as admin and member', async () => {
      const { createGroup } = await import('./groupService');
      const signer = createMockSigner();
      const relay = createMockRelay();

      await createGroup(signer, relay, { name: 'Test Group' });

      const adminTags = relay.published[1].tags.filter((t) => t[0] === 'p');
      expect(adminTags[0][1]).toBe(TEST_PUBKEY);

      const memberTags = relay.published[2].tags.filter((t) => t[0] === 'p');
      expect(memberTags[0][1]).toBe(TEST_PUBKEY);
    });
  });

  describe('readGroupMembers', () => {
    it('returns empty members for a group with no events', async () => {
      const { readGroupMembers } = await import('./groupService');
      const relay = createMockRelay();

      const result = await readGroupMembers(relay, 'nonexistent');

      expect(result).toEqual({ ok: true, members: [] });
    });

    it('returns ok:false when the relay throws', async () => {
      const { readGroupMembers } = await import('./groupService');
      const relay = createMockRelay();
      relay.fetch = async () => { throw new Error('offline'); };

      const result = await readGroupMembers(relay, 'test');

      expect(result.ok).toBe(false);
    });
  });

  describe('updateGroupMetadata', () => {
    it('refuses a nameless save', async () => {
      const { updateGroupMetadata } = await import('./groupService');
      const signer = createMockSigner();
      const relay = createMockRelay();

      const result = await updateGroupMetadata(signer, relay, 'test-group', {
        name: '',
        about: 'some description',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/name/i);
      expect(relay.published).toHaveLength(0);
    });

    it('publishes metadata with trimmed values', async () => {
      const { updateGroupMetadata } = await import('./groupService');
      const signer = createMockSigner();
      const relay = createMockRelay();

      const result = await updateGroupMetadata(signer, relay, 'test-group', {
        name: '  My Project  ',
        about: '  Cool project  ',
      });

      expect(result.ok).toBe(true);
      const nameTags = relay.published[0].tags.filter((t) => t[0] === 'name');
      expect(nameTags[0][1]).toBe('My Project');
    });
  });
});
