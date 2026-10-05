/**
 * Headless integration test: prove that Space operations work with a
 * throwaway key and no React.
 *
 * This is the "headless parity proof" requested by cloistr-orchestrator:
 * a group post and a thread message, built and signed by a throwaway key,
 * without any React dependency in the call chain.
 *
 * The signer is a plain SignerInterface from @cloistr/auth/core, backed
 * by nostr-tools' finalizeEvent. No NDK, no hooks.
 */
import { describe, it, expect, vi } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';
import type { SignerInterface, RelayClient } from './headless';
import type { Event, UnsignedEvent } from 'nostr-tools';
import {
  GROUP_METADATA_KIND,
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  GROUP_JOIN_REQUEST_KIND,
} from '@/types/groups';
import { GIFT_WRAP_KIND } from './threads/giftWrap';

function createHeadlessSigner(secretKey: Uint8Array): SignerInterface {
  const pubkey = getPublicKey(secretKey);
  return {
    getPublicKey: async () => pubkey,
    signEvent: async (unsigned: UnsignedEvent): Promise<Event> =>
      finalizeEvent(unsigned, secretKey) as Event,
    encrypt: async () => { throw new Error('not needed'); },
    decrypt: async () => { throw new Error('not needed'); },
  };
}

function createHeadlessRelay(): RelayClient & { events: Event[] } {
  const events: Event[] = [];
  return {
    events,
    publish: async (event: Event) => {
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
    const signer = createHeadlessSigner(sk);
    const relay = createHeadlessRelay();

    const groupId = await createGroup(signer, relay, {
      name: 'headless-test',
      description: 'Created without React',
    });

    expect(groupId).toContain(pk.slice(0, 16));
    expect(relay.events).toHaveLength(3);
    expect(relay.events[0].kind).toBe(GROUP_METADATA_KIND);
    expect(relay.events[1].kind).toBe(GROUP_ADMINS_KIND);
    expect(relay.events[2].kind).toBe(GROUP_MEMBERS_KIND);

    for (const event of relay.events) {
      expect(event.id).toHaveLength(64);
      expect(event.sig).toHaveLength(128);
      expect(event.pubkey).toBe(pk);
    }
  });

  it('joins a group with a throwaway key, no React', async () => {
    const { joinGroup } = await import('./groups/groupService');
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const signer = createHeadlessSigner(sk);
    const relay = createHeadlessRelay();

    await joinGroup(signer, relay, 'some-group-id', 'hello');

    expect(relay.events).toHaveLength(1);
    expect(relay.events[0].kind).toBe(GROUP_JOIN_REQUEST_KIND);
    expect(relay.events[0].pubkey).toBe(pk);
    expect(relay.events[0].tags).toEqual([['h', 'some-group-id']]);
    expect(relay.events[0].content).toBe('hello');
  });

  it('sends a thread message with a throwaway key, no React', async () => {
    const { publishMessage } = await import('./threads/threadPublish');
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const threadSecret = bytesToHex(generateSecretKey());
    const relay = createHeadlessRelay();

    await publishMessage(relay, 'headless thread message', pk, threadSecret);

    expect(relay.events).toHaveLength(1);
    expect(relay.events[0].kind).toBe(GIFT_WRAP_KIND);
    // One-time key, not the user's key
    expect(relay.events[0].pubkey).not.toBe(pk);
    expect(relay.events[0].id).toHaveLength(64);
    expect(relay.events[0].sig).toHaveLength(128);

    const tTag = relay.events[0].tags.find((t: string[]) => t[0] === 't');
    expect(tTag).toBeDefined();
    expect(tTag![1]).toMatch(/^[0-9a-f]{2}$/);
  });

  it('grants a thread key with a throwaway key, no React', async () => {
    const { publishKeyHandoff } = await import('./threads/threadPublish');
    const granterSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const threadSecret = bytesToHex(generateSecretKey());
    const relay = createHeadlessRelay();

    await publishKeyHandoff(relay, 'thread-123', threadSecret, granterSk, recipientPk);

    expect(relay.events).toHaveLength(1);
    expect(relay.events[0].kind).toBe(GIFT_WRAP_KIND);
  });

  it('posts, reacts and reposts with a throwaway key, no React', async () => {
    const { postNote, reactToNote, repostNote } = await import('./social/noteService');
    const { verifyEvent } = await import('nostr-tools');
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const signer = createHeadlessSigner(sk);
    const relay = createHeadlessRelay();

    const posted = await postNote(signer, relay, 'headless note #parity');
    await reactToNote(signer, relay, posted.eventId, pk);
    await repostNote(signer, relay, posted.eventId, pk);

    expect(relay.events.map((e) => e.kind)).toEqual([1, 7, 6]);
    for (const e of relay.events) {
      expect(e.pubkey).toBe(pk);
      expect(verifyEvent(e)).toBe(true);
    }
    expect(relay.events[1].tags).toContainEqual(['e', posted.eventId]);
  });

  it('uploads a file and describes it with a throwaway key, no React', async () => {
    const { uploadBlob, publishFileMetadata } = await import('./cloistr/upload');
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const signer = createHeadlessSigner(sk);
    const relay = createHeadlessRelay();
    const blob = new Blob(['headless upload'], { type: 'text/plain' });

    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const descriptor = await uploadBlob(signer, blob, { baseUrl: 'https://files.example' });
      await publishFileMetadata(signer, relay, descriptor, { name: 'note.txt' });

      expect(descriptor.url).toBe(`https://files.example/${descriptor.sha256}`);
      expect(relay.events[0].kind).toBe(1063);
      expect(relay.events[0].pubkey).toBe(pk);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('follows and unfollows with a throwaway key, no React', async () => {
    const { followContact, unfollowContact } = await import('./crdt/contactsService');
    const { verifyEvent } = await import('nostr-tools');
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const friend = getPublicKey(generateSecretKey());
    const signer = createHeadlessSigner(sk);
    // A relay that serves back what it was given, so the unfollow reads the follow.
    const relay = createHeadlessRelay();
    relay.fetch = async () => relay.events.slice(-1);

    expect((await followContact(signer, relay, pk, friend, { createIfMissing: true })).ok).toBe(true);
    expect((await unfollowContact(signer, relay, pk, friend)).ok).toBe(true);

    const [follow, unfollow] = relay.events;
    expect(verifyEvent(follow) && verifyEvent(unfollow)).toBe(true);
    expect(follow.tags.find((t) => t[1] === friend)?.[0]).toBe('p');
    expect(unfollow.tags.find((t) => t[1] === friend)?.[0]).toBe('np');
  });
});
