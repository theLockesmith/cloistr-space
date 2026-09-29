import { describe, it, expect } from 'vitest';
import type { NostrClient, SignedNostrEvent } from '../headless';
import { GIFT_WRAP_KIND } from './giftWrap';

function createMockClient(): NostrClient & { signed: SignedNostrEvent[] } {
  const signed: SignedNostrEvent[] = [];
  return {
    signed,
    getPublicKey: async () => 'aabb'.repeat(8),
    signAndPublish: async () => 1,
    publishSigned: async (event) => {
      signed.push(event);
      return 1;
    },
    fetch: async () => [],
  };
}

describe('threadPublish', () => {
  describe('publishMessage', () => {
    it('publishes a kind:1059 gift wrap', async () => {
      const { publishMessage } = await import('./threadPublish');
      const client = createMockClient();
      const threadSecret = 'cc'.repeat(32);
      const authorPk = 'dd'.repeat(32);

      await publishMessage(client, 'hello world', authorPk, threadSecret);

      expect(client.signed).toHaveLength(1);
      expect(client.signed[0].kind).toBe(GIFT_WRAP_KIND);
    });

    it('produces a valid signed event with id and sig', async () => {
      const { publishMessage } = await import('./threadPublish');
      const client = createMockClient();
      const threadSecret = 'cc'.repeat(32);
      const authorPk = 'dd'.repeat(32);

      await publishMessage(client, 'test message', authorPk, threadSecret);

      const event = client.signed[0];
      expect(event.id).toHaveLength(64);
      expect(event.sig).toHaveLength(128);
      expect(event.pubkey).toHaveLength(64);
    });

    it('tags the event with a bucket value', async () => {
      const { publishMessage } = await import('./threadPublish');
      const client = createMockClient();
      const threadSecret = 'cc'.repeat(32);

      await publishMessage(client, 'msg', 'dd'.repeat(32), threadSecret);

      const tTag = client.signed[0].tags.find((t) => t[0] === 't');
      expect(tTag).toBeDefined();
      expect(tTag![1]).toMatch(/^[0-9a-f]{2}$/);
    });
  });

  describe('publishKeyHandoff', () => {
    it('publishes a kind:1059 gift wrap for the handoff', async () => {
      const { publishKeyHandoff } = await import('./threadPublish');
      const client = createMockClient();
      const threadSecret = 'cc'.repeat(32);
      const granterSk = new Uint8Array(32);
      granterSk[0] = 1; // valid non-zero key
      const recipientPk = 'ee'.repeat(32);

      await publishKeyHandoff(client, 'thread-1', threadSecret, granterSk, recipientPk);

      expect(client.signed).toHaveLength(1);
      expect(client.signed[0].kind).toBe(GIFT_WRAP_KIND);
    });
  });
});
