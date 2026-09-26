/**
 * @fileoverview Tests for the bucket writer's core logic.
 *
 * The React hook needs NDK mocking. These tests verify that the wrapping
 * functions produce publishable events (valid sig, correct kind, correct
 * bucket tag) — the same properties the writer hook relies on.
 */

import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import {
  wrapThreadMessage,
  wrapKeyHandoff,
  tryUnwrapMessage,
  tryUnwrapHandoff,
  GIFT_WRAP_KIND,
  type ThreadRumor,
} from './giftWrap';
import { ThreadKeyStore } from './threadKeyStore';
import { getWindowId, bucketToTag, computeThreadBucket, computeHandoffBucket } from './bucketCrypto';
import { nip44 } from 'nostr-tools';

describe('writer: wrapThreadMessage produces a publishable event', () => {
  const threadSk = generateSecretKey();
  const authorSk = generateSecretKey();

  function makeRumor(): ThreadRumor {
    return {
      kind: 1111,
      pubkey: getPublicKey(authorSk),
      content: 'Test message from writer',
      tags: [['subject', 'Writer test']],
      created_at: Math.floor(Date.now() / 1000),
    };
  }

  it('event has all required fields for NDK publish', () => {
    const wrap = wrapThreadMessage(makeRumor(), threadSk);

    expect(wrap.id).toMatch(/^[0-9a-f]{64}$/);
    expect(wrap.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(wrap.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(wrap.kind).toBe(GIFT_WRAP_KIND);
    expect(wrap.content).toBeTruthy();
    expect(wrap.tags).toHaveLength(1);
    expect(wrap.created_at).toBeGreaterThan(0);
  });

  it('event signature is valid (NDK will not re-sign)', () => {
    const wrap = wrapThreadMessage(makeRumor(), threadSk);
    expect(verifyEvent(wrap)).toBe(true);
  });

  it('bucket tag matches the thread+window computation', () => {
    const windowId = getWindowId();
    const wrap = wrapThreadMessage(makeRumor(), threadSk, windowId);
    const expected = bucketToTag(computeThreadBucket(threadSk, windowId));
    const actual = wrap.tags.find((t: string[]) => t[0] === 'bucket')?.[1];
    expect(actual).toBe(expected);
  });

  it('reader can decrypt what the writer wraps', () => {
    const wrap = wrapThreadMessage(makeRumor(), threadSk);
    const store = new ThreadKeyStore();
    store.set(getPublicKey(threadSk), threadSk);
    const result = tryUnwrapMessage(wrap, store);
    expect(result).not.toBeNull();
    expect(result!.rumor.content).toBe('Test message from writer');
  });
});

describe('writer: wrapKeyHandoff produces a publishable event', () => {
  const threadSk = generateSecretKey();
  const granterSk = generateSecretKey();
  const recipientSk = generateSecretKey();
  const recipientPk = getPublicKey(recipientSk);

  it('event has all required fields for NDK publish', () => {
    const wrap = wrapKeyHandoff(threadSk, granterSk, recipientPk);

    expect(wrap.id).toMatch(/^[0-9a-f]{64}$/);
    expect(wrap.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(wrap.kind).toBe(GIFT_WRAP_KIND);
  });

  it('event signature is valid', () => {
    const wrap = wrapKeyHandoff(threadSk, granterSk, recipientPk);
    expect(verifyEvent(wrap)).toBe(true);
  });

  it('bucket tag matches the ECDH handoff computation', () => {
    const windowId = getWindowId();
    const wrap = wrapKeyHandoff(threadSk, granterSk, recipientPk, windowId);

    const shared = nip44.v2.utils.getConversationKey(granterSk, recipientPk);
    const expected = bucketToTag(computeHandoffBucket(shared, windowId));
    const actual = wrap.tags.find((t: string[]) => t[0] === 'bucket')?.[1];
    expect(actual).toBe(expected);
  });

  it('recipient can unwrap and recover the thread key', () => {
    const wrap = wrapKeyHandoff(threadSk, granterSk, recipientPk);
    const handoff = tryUnwrapHandoff(wrap, recipientSk);
    expect(handoff).not.toBeNull();
    expect(handoff!.threadPubkey).toBe(getPublicKey(threadSk));
  });
});
