import { describe, it, expect } from 'vitest';
import type { RelayClient } from '../headless';
import type { Event } from 'nostr-tools';
import { GIFT_WRAP_KIND } from './giftWrap';

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

describe('threadPublish', () => {
  describe('publishMessage', () => {
    it('publishes a kind:1059 gift wrap', async () => {
      const { publishMessage } = await import('./threadPublish');
      const relay = createMockRelay();
      const threadSecret = 'cc'.repeat(32);
      const authorPk = 'dd'.repeat(32);

      await publishMessage(relay, 'hello world', authorPk, threadSecret);

      expect(relay.published).toHaveLength(1);
      expect(relay.published[0].kind).toBe(GIFT_WRAP_KIND);
    });

    it('produces a valid signed event with id and sig', async () => {
      const { publishMessage } = await import('./threadPublish');
      const relay = createMockRelay();
      const threadSecret = 'cc'.repeat(32);
      const authorPk = 'dd'.repeat(32);

      await publishMessage(relay, 'test message', authorPk, threadSecret);

      const event = relay.published[0];
      expect(event.id).toHaveLength(64);
      expect(event.sig).toHaveLength(128);
      expect(event.pubkey).toHaveLength(64);
    });

    it('tags the event with a bucket value', async () => {
      const { publishMessage } = await import('./threadPublish');
      const relay = createMockRelay();
      const threadSecret = 'cc'.repeat(32);

      await publishMessage(relay, 'msg', 'dd'.repeat(32), threadSecret);

      const tTag = relay.published[0].tags.find((t) => t[0] === 't');
      expect(tTag).toBeDefined();
      expect(tTag![1]).toMatch(/^[0-9a-f]{2}$/);
    });
  });

  describe('when no relay accepts', () => {
    it('publishMessage throws rather than reporting a send', async () => {
      const { publishMessage } = await import('./threadPublish');
      const relay = { ...createMockRelay(), publish: async () => 0 };

      await expect(publishMessage(relay, 'hi', 'dd'.repeat(32), 'cc'.repeat(32))).rejects.toThrow(
        /No relay accepted/,
      );
    });

    it('publishKeyHandoff throws rather than reporting a grant', async () => {
      const { publishKeyHandoff } = await import('./threadPublish');
      const { generateSecretKey, getPublicKey } = await import('nostr-tools');
      const relay = { ...createMockRelay(), publish: async () => 0 };

      await expect(
        publishKeyHandoff(relay, 't1', 'cc'.repeat(32), generateSecretKey(), getPublicKey(generateSecretKey())),
      ).rejects.toThrow(/No relay accepted/);
    });
  });

  describe('publishKeyHandoff', () => {
    it('publishes a kind:1059 gift wrap for the handoff', async () => {
      const { publishKeyHandoff } = await import('./threadPublish');
      const relay = createMockRelay();
      const threadSecret = 'cc'.repeat(32);
      const granterSk = new Uint8Array(32);
      granterSk[0] = 1;
      const recipientPk = 'ee'.repeat(32);

      await publishKeyHandoff(relay, 'thread-1', threadSecret, granterSk, recipientPk);

      expect(relay.published).toHaveLength(1);
      expect(relay.published[0].kind).toBe(GIFT_WRAP_KIND);
    });
  });
});
