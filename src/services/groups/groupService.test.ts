import { describe, it, expect, vi } from 'vitest';
import type { NostrClient } from '../headless';
import {
  GROUP_METADATA_KIND,
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  GROUP_JOIN_REQUEST_KIND,
  GROUP_LEAVE_REQUEST_KIND,
} from '@/types/groups';

// Will be imported from groupService once it exists
// import { joinGroup, leaveGroup, createGroup, ... } from './groupService';

function createMockClient(pubkey = 'aabb'.repeat(8)): NostrClient & { published: Array<{ kind: number; content: string; tags: string[][] }> } {
  const published: Array<{ kind: number; content: string; tags: string[][] }> = [];
  return {
    published,
    getPublicKey: async () => pubkey,
    signAndPublish: async (template) => {
      published.push(template);
      return 1;
    },
    publishSigned: async () => 1,
    fetch: async () => [],
  };
}

describe('groupService', () => {
  describe('joinGroup', () => {
    it('publishes a kind:9021 event with the group id', async () => {
      const { joinGroup } = await import('./groupService');
      const client = createMockClient();
      await joinGroup(client, 'test-group');

      expect(client.published).toHaveLength(1);
      expect(client.published[0].kind).toBe(GROUP_JOIN_REQUEST_KIND);
      expect(client.published[0].tags).toEqual([['h', 'test-group']]);
      expect(client.published[0].content).toBe('');
    });

    it('includes the join message when provided', async () => {
      const { joinGroup } = await import('./groupService');
      const client = createMockClient();
      await joinGroup(client, 'test-group', 'please let me in');

      expect(client.published[0].content).toBe('please let me in');
    });
  });

  describe('leaveGroup', () => {
    it('publishes a kind:9022 event with the group id', async () => {
      const { leaveGroup } = await import('./groupService');
      const client = createMockClient();
      await leaveGroup(client, 'test-group');

      expect(client.published).toHaveLength(1);
      expect(client.published[0].kind).toBe(GROUP_LEAVE_REQUEST_KIND);
      expect(client.published[0].tags).toEqual([['h', 'test-group']]);
    });
  });

  describe('createGroup', () => {
    it('publishes metadata, admin list, and member list', async () => {
      const { createGroup } = await import('./groupService');
      const pubkey = 'aabb'.repeat(8);
      const client = createMockClient(pubkey);

      const id = await createGroup(client, { name: 'test-project' });

      expect(client.published).toHaveLength(3);
      expect(client.published[0].kind).toBe(GROUP_METADATA_KIND);
      expect(client.published[1].kind).toBe(GROUP_ADMINS_KIND);
      expect(client.published[2].kind).toBe(GROUP_MEMBERS_KIND);

      // identifier embeds the creator's pubkey prefix
      expect(id).toContain(pubkey.slice(0, 16));
    });

    it('sets the creator as admin with full permissions', async () => {
      const { createGroup } = await import('./groupService');
      const pubkey = 'aabb'.repeat(8);
      const client = createMockClient(pubkey);

      await createGroup(client, { name: 'test' });

      const adminTags = client.published[1].tags;
      const pTag = adminTags.find((t) => t[0] === 'p');
      expect(pTag?.[1]).toBe(pubkey);
      expect(pTag?.slice(2)).toContain('add-user');
      expect(pTag?.slice(2)).toContain('edit-metadata');
    });

    it('sets the creator as member', async () => {
      const { createGroup } = await import('./groupService');
      const pubkey = 'aabb'.repeat(8);
      const client = createMockClient(pubkey);

      await createGroup(client, { name: 'test' });

      const memberTags = client.published[2].tags;
      expect(memberTags).toContainEqual(['p', pubkey]);
    });
  });

  describe('readGroupMembers', () => {
    it('returns members from fetched events (legacy group)', async () => {
      const { readGroupMembers } = await import('./groupService');
      const client = createMockClient();
      const memberA = 'aaaa'.repeat(8);
      const memberB = 'bbbb'.repeat(8);

      vi.spyOn(client, 'fetch').mockResolvedValueOnce([
        {
          id: '1'.repeat(64),
          pubkey: 'owner'.padEnd(64, '0'),
          kind: GROUP_MEMBERS_KIND,
          created_at: 1000,
          tags: [['d', 'legacy-group'], ['p', memberA], ['p', memberB]],
          content: '',
        },
      ]);

      const result = await readGroupMembers(client, 'legacy-group');
      expect(result.ok).toBe(true);
      expect(result.members).toContain(memberA);
      expect(result.members).toContain(memberB);
    });

    it('returns ok:false when fetch throws', async () => {
      const { readGroupMembers } = await import('./groupService');
      const client = createMockClient();
      vi.spyOn(client, 'fetch').mockRejectedValueOnce(new Error('network'));

      const result = await readGroupMembers(client, 'group');
      expect(result.ok).toBe(false);
    });
  });

  describe('updateGroupMetadata', () => {
    it('refuses a nameless save', async () => {
      const { updateGroupMetadata } = await import('./groupService');
      const client = createMockClient();

      const result = await updateGroupMetadata(client, 'group-id', { name: '' });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('name');
      expect(client.published).toHaveLength(0);
    });

    it('publishes metadata with trimmed values', async () => {
      const { updateGroupMetadata } = await import('./groupService');
      const client = createMockClient();

      const result = await updateGroupMetadata(client, 'group-id', {
        name: '  My Project  ',
        about: '  A description  ',
      });
      expect(result.ok).toBe(true);
      expect(client.published).toHaveLength(1);

      const tags = client.published[0].tags;
      expect(tags).toContainEqual(['name', 'My Project']);
      expect(tags).toContainEqual(['about', 'A description']);
    });
  });
});
