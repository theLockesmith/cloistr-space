/**
 * Headless integration test: prove that Space operations work with a
 * throwaway key and no React.
 *
 * This is the "headless parity proof" requested by cloistr-orchestrator:
 * a group post and a thread message, built and signed by a throwaway key,
 * without any React dependency in the call chain.
 */
import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';
import type { NostrClient, SignedNostrEvent } from './headless';
import {
  GROUP_METADATA_KIND,
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  GROUP_JOIN_REQUEST_KIND,
} from '@/types/groups';
import { GIFT_WRAP_KIND } from './threads/giftWrap';

function createHeadlessClient(secretKey: Uint8Array): NostrClient & { events: SignedNostrEvent[] } {
  const pubkey = getPublicKey(secretKey);
  const events: SignedNostrEvent[] = [];

  return {
    events,
    getPublicKey: async () => pubkey,
    signAndPublish: async (template) => {
      const event = finalizeEvent(
        {
          kind: template.kind,
          content: template.content,
          tags: template.tags,
          created_at: Math.floor(Date.now() / 1000),
        },
        secretKey,
      );
      events.push(event as SignedNostrEvent);
      return 1;
    },
    publishSigned: async (event) => {
      events.push(event);
      return 1;
    },
    fetch: async () => [],
  };
}

describe('headless parity proof', () => {
  it('creates a group with a throwaway key, no React', async () => {
    const { createGroup } = await import('./groups/groupService');
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const client = createHeadlessClient(sk);

    const groupId = await createGroup(client, {
      name: 'headless-test',
      description: 'Created without React',
    });

    expect(groupId).toContain(pk.slice(0, 16));
    expect(client.events).toHaveLength(3);
    expect(client.events[0].kind).toBe(GROUP_METADATA_KIND);
    expect(client.events[1].kind).toBe(GROUP_ADMINS_KIND);
    expect(client.events[2].kind).toBe(GROUP_MEMBERS_KIND);

    // Every event is validly signed (has id and sig)
    for (const event of client.events) {
      expect(event.id).toHaveLength(64);
      expect(event.sig).toHaveLength(128);
      expect(event.pubkey).toBe(pk);
    }
  });

  it('joins a group with a throwaway key, no React', async () => {
    const { joinGroup } = await import('./groups/groupService');
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const client = createHeadlessClient(sk);

    await joinGroup(client, 'some-group-id', 'hello');

    expect(client.events).toHaveLength(1);
    expect(client.events[0].kind).toBe(GROUP_JOIN_REQUEST_KIND);
    expect(client.events[0].pubkey).toBe(pk);
    expect(client.events[0].tags).toEqual([['h', 'some-group-id']]);
    expect(client.events[0].content).toBe('hello');
  });

  it('sends a thread message with a throwaway key, no React', async () => {
    const { publishMessage } = await import('./threads/threadPublish');
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const threadSecret = bytesToHex(generateSecretKey());
    const client = createHeadlessClient(sk);

    await publishMessage(client, 'headless thread message', pk, threadSecret);

    expect(client.events).toHaveLength(1);
    expect(client.events[0].kind).toBe(GIFT_WRAP_KIND);
    // One-time key, not the user's key
    expect(client.events[0].pubkey).not.toBe(pk);
    expect(client.events[0].id).toHaveLength(64);
    expect(client.events[0].sig).toHaveLength(128);

    // Tagged with a bucket
    const tTag = client.events[0].tags.find((t: string[]) => t[0] === 't');
    expect(tTag).toBeDefined();
    expect(tTag![1]).toMatch(/^[0-9a-f]{2}$/);
  });

  it('grants a thread key with a throwaway key, no React', async () => {
    const { publishKeyHandoff } = await import('./threads/threadPublish');
    const granterSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const threadSecret = bytesToHex(generateSecretKey());
    const client = createHeadlessClient(granterSk);

    await publishKeyHandoff(client, 'thread-123', threadSecret, granterSk, recipientPk);

    expect(client.events).toHaveLength(1);
    expect(client.events[0].kind).toBe(GIFT_WRAP_KIND);
  });
});
