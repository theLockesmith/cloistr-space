/**
 * @fileoverview Tests for kind 1059 gift-wrap construction and trial decryption.
 *
 * Covers the three core operations:
 * 1. Wrapping a thread message (author writes)
 * 2. Trial-decrypting a message (member reads)
 * 3. Wrapping and unwrapping a key handoff (granter grants, member receives)
 *
 * ADMISSION cases (member opens, bystander cannot) are tested alongside
 * refusal cases (wrong key, wrong thread) as required by the task definition.
 */

import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import { ThreadKeyStore } from './threadKeyStore';
import {
  GIFT_WRAP_KIND,
  wrapThreadMessage,
  tryUnwrapMessage,
  wrapKeyHandoff,
  tryUnwrapHandoff,
  type ThreadRumor,
} from './giftWrap';
import { getWindowId, WINDOW_SECONDS } from './bucketCrypto';

// Test fixtures
function makeRumor(authorSk: Uint8Array, content: string): ThreadRumor {
  return {
    kind: 1111,
    pubkey: getPublicKey(authorSk),
    content,
    tags: [['subject', 'Test thread']],
    created_at: Math.floor(Date.now() / 1000),
  };
}

describe('wrapThreadMessage', () => {
  const threadSk = generateSecretKey();
  const authorSk = generateSecretKey();
  const rumor = makeRumor(authorSk, 'Hello sealed world');

  it('produces a kind 1059 event', () => {
    const wrap = wrapThreadMessage(rumor, threadSk);
    expect(wrap.kind).toBe(GIFT_WRAP_KIND);
  });

  it('is signed by a one-time key, not the author', () => {
    const wrap = wrapThreadMessage(rumor, threadSk);
    expect(wrap.pubkey).not.toBe(rumor.pubkey);
    expect(verifyEvent(wrap)).toBe(true);
  });

  it('carries only a bucket tag, no p/h/thread/author tags', () => {
    const wrap = wrapThreadMessage(rumor, threadSk);
    const tagNames = wrap.tags.map((t: string[]) => t[0]);
    expect(tagNames).toEqual(['bucket']);
    expect(tagNames).not.toContain('p');
    expect(tagNames).not.toContain('h');
    expect(tagNames).not.toContain('thread');
  });

  it('uses a different one-time key each time', () => {
    const a = wrapThreadMessage(rumor, threadSk);
    const b = wrapThreadMessage(rumor, threadSk);
    expect(a.pubkey).not.toBe(b.pubkey);
  });

  it('timestamp falls within the window', () => {
    const wid = getWindowId();
    const wrap = wrapThreadMessage(rumor, threadSk, wid);
    const windowStart = wid * WINDOW_SECONDS;
    const windowEnd = windowStart + WINDOW_SECONDS;
    expect(wrap.created_at).toBeGreaterThanOrEqual(windowStart);
    expect(wrap.created_at).toBeLessThan(windowEnd);
  });
});

describe('tryUnwrapMessage', () => {
  const threadSk = generateSecretKey();
  const threadPubkey = getPublicKey(threadSk);
  const authorSk = generateSecretKey();
  const rumor = makeRumor(authorSk, 'Sealed message content');

  it('ADMISSION: member with the thread key decrypts the message', () => {
    const wrap = wrapThreadMessage(rumor, threadSk);
    const store = new ThreadKeyStore();
    store.set(threadPubkey, threadSk);

    const result = tryUnwrapMessage(wrap, store);
    expect(result).not.toBeNull();
    expect(result!.rumor.content).toBe('Sealed message content');
    expect(result!.rumor.pubkey).toBe(getPublicKey(authorSk));
    expect(result!.threadPubkey).toBe(threadPubkey);
  });

  it('NEGATIVE: bystander without the thread key gets null', () => {
    const wrap = wrapThreadMessage(rumor, threadSk);
    const store = new ThreadKeyStore();
    // Store has a DIFFERENT thread key
    const otherSk = generateSecretKey();
    store.set(getPublicKey(otherSk), otherSk);

    const result = tryUnwrapMessage(wrap, store);
    expect(result).toBeNull();
  });

  it('NEGATIVE: empty key store gets null', () => {
    const wrap = wrapThreadMessage(rumor, threadSk);
    const store = new ThreadKeyStore();

    const result = tryUnwrapMessage(wrap, store);
    expect(result).toBeNull();
  });

  it('finds the right key among many', () => {
    const wrap = wrapThreadMessage(rumor, threadSk);
    const store = new ThreadKeyStore();

    // Add several wrong keys
    for (let i = 0; i < 5; i++) {
      const sk = generateSecretKey();
      store.set(getPublicKey(sk), sk);
    }
    // Add the right one
    store.set(threadPubkey, threadSk);

    const result = tryUnwrapMessage(wrap, store);
    expect(result).not.toBeNull();
    expect(result!.rumor.content).toBe('Sealed message content');
  });

  it('preserves all inner event fields', () => {
    const fullRumor: ThreadRumor = {
      kind: 1111,
      pubkey: getPublicKey(authorSk),
      content: 'Full rumor test',
      tags: [
        ['subject', 'My Thread'],
        ['E', 'rootid123', '', getPublicKey(authorSk)],
      ],
      created_at: 1700000000,
    };
    const wrap = wrapThreadMessage(fullRumor, threadSk);
    const store = new ThreadKeyStore();
    store.set(threadPubkey, threadSk);

    const result = tryUnwrapMessage(wrap, store);
    expect(result!.rumor.kind).toBe(1111);
    expect(result!.rumor.tags).toEqual(fullRumor.tags);
    expect(result!.rumor.created_at).toBe(1700000000);
  });
});

describe('wrapKeyHandoff', () => {
  const threadSk = generateSecretKey();
  const granterSk = generateSecretKey();
  const recipientSk = generateSecretKey();
  const recipientPubkey = getPublicKey(recipientSk);

  it('produces a kind 1059 event with a bucket tag', () => {
    const wrap = wrapKeyHandoff(threadSk, granterSk, recipientPubkey);
    expect(wrap.kind).toBe(GIFT_WRAP_KIND);
    expect(wrap.tags.map((t: string[]) => t[0])).toEqual(['bucket']);
  });

  it('is signed by a one-time key, not the granter', () => {
    const wrap = wrapKeyHandoff(threadSk, granterSk, recipientPubkey);
    expect(wrap.pubkey).not.toBe(getPublicKey(granterSk));
    expect(verifyEvent(wrap)).toBe(true);
  });

  it('carries no p tag (recipient is hidden)', () => {
    const wrap = wrapKeyHandoff(threadSk, granterSk, recipientPubkey);
    const pTags = wrap.tags.filter((t: string[]) => t[0] === 'p');
    expect(pTags).toHaveLength(0);
  });
});

describe('tryUnwrapHandoff', () => {
  const threadSk = generateSecretKey();
  const threadPubkey = getPublicKey(threadSk);
  const granterSk = generateSecretKey();
  const recipientSk = generateSecretKey();
  const recipientPubkey = getPublicKey(recipientSk);

  it('ADMISSION: recipient unwraps the thread key', () => {
    const wrap = wrapKeyHandoff(threadSk, granterSk, recipientPubkey);
    const result = tryUnwrapHandoff(wrap, recipientSk);

    expect(result).not.toBeNull();
    expect(result!.threadPubkey).toBe(threadPubkey);
    expect(result!.threadSecretHex).toBe(bytesToHex(threadSk));
  });

  it('NEGATIVE: bystander cannot unwrap', () => {
    const wrap = wrapKeyHandoff(threadSk, granterSk, recipientPubkey);
    const bystander = generateSecretKey();
    const result = tryUnwrapHandoff(wrap, bystander);

    expect(result).toBeNull();
  });

  it('unwrapped key actually decrypts thread messages', () => {
    // Full round trip: grant key, unwrap it, use it to read a message
    const wrap = wrapKeyHandoff(threadSk, granterSk, recipientPubkey);
    const handoff = tryUnwrapHandoff(wrap, recipientSk)!;

    // Use the unwrapped key to read a message
    const recoveredSk = hexToBytes(handoff.threadSecretHex);
    const store = new ThreadKeyStore();
    store.set(handoff.threadPubkey, recoveredSk);

    const authorSk = generateSecretKey();
    const rumor = makeRumor(authorSk, 'Post-handoff message');
    const msgWrap = wrapThreadMessage(rumor, threadSk);

    const result = tryUnwrapMessage(msgWrap, store);
    expect(result).not.toBeNull();
    expect(result!.rumor.content).toBe('Post-handoff message');
  });

  it('NEGATIVE: removed member cannot read post-rotation messages', () => {
    // The old key worked, then the thread key rotated
    const oldThreadSk = threadSk;
    const newThreadSk = generateSecretKey();

    // Member was removed: they still hold oldThreadSk but not newThreadSk
    const store = new ThreadKeyStore();
    store.set(getPublicKey(oldThreadSk), oldThreadSk);

    // New message encrypted with the rotated key
    const authorSk = generateSecretKey();
    const rumor = makeRumor(authorSk, 'After rotation');
    const msgWrap = wrapThreadMessage(rumor, newThreadSk);

    const result = tryUnwrapMessage(msgWrap, store);
    expect(result).toBeNull();
  });
});
