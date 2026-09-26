/**
 * @fileoverview Tests for bucket reader primitives.
 *
 * The React hook needs a full NDK provider mock, so these tests cover the
 * pure function (computeRealBuckets) and the round trip: a message wrapped
 * for a thread lands in the right bucket and decrypts with the right key.
 */

import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { hexToBytes } from 'nostr-tools/utils';
import { ThreadKeyStore } from './threadKeyStore';
import { computeRealBuckets } from './useBucketReader';
import {
  computeThreadBucket,
  computeHandoffBucket,
  BUCKETS_PER_READER,
  generateBucketSet,
  tagToBucket,
} from './bucketCrypto';
import {
  wrapThreadMessage,
  wrapKeyHandoff,
  tryUnwrapMessage,
  tryUnwrapHandoff,
  type ThreadRumor,
} from './giftWrap';

describe('computeRealBuckets', () => {
  it('includes a bucket for each held thread key', () => {
    const store = new ThreadKeyStore();
    const sk1 = generateSecretKey();
    const sk2 = generateSecretKey();
    store.set(getPublicKey(sk1), sk1);
    store.set(getPublicKey(sk2), sk2);

    const windowId = 1000;
    const buckets = computeRealBuckets(store, windowId, null, []);

    expect(buckets).toContain(computeThreadBucket(sk1, windowId));
    expect(buckets).toContain(computeThreadBucket(sk2, windowId));
  });

  it('includes handoff buckets when recipientSecret is provided', () => {
    const store = new ThreadKeyStore();
    const recipientSk = generateSecretKey();
    const granterSk = generateSecretKey();
    const granterPk = getPublicKey(granterSk);
    const windowId = 1000;

    const shared = nip44.v2.utils.getConversationKey(recipientSk, granterPk);
    const expected = computeHandoffBucket(shared, windowId);

    const buckets = computeRealBuckets(store, windowId, recipientSk, [granterPk]);
    expect(buckets).toContain(expected);
  });

  it('returns empty when store is empty and no granters', () => {
    const store = new ThreadKeyStore();
    const buckets = computeRealBuckets(store, 1000, null, []);
    expect(buckets).toEqual([]);
  });

  it('deduplicates when thread and handoff buckets collide', () => {
    const store = new ThreadKeyStore();
    const threadSk = generateSecretKey();
    store.set(getPublicKey(threadSk), threadSk);

    const recipientSk = generateSecretKey();
    const granterPk = getPublicKey(generateSecretKey());

    const buckets = computeRealBuckets(store, 1000, recipientSk, [granterPk]);
    const unique = new Set(buckets);
    expect(buckets.length).toBe(unique.size);
  });
});

describe('bucket reader round trip', () => {
  it('a message wrapped for a thread lands in its computed bucket', () => {
    const threadSk = generateSecretKey();
    const threadPk = getPublicKey(threadSk);
    const authorSk = generateSecretKey();
    const windowId = 2000;

    const rumor: ThreadRumor = {
      kind: 1111,
      pubkey: getPublicKey(authorSk),
      content: 'Round trip test',
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    const wrap = wrapThreadMessage(rumor, threadSk, windowId);

    // The wrap's bucket tag matches what computeRealBuckets produces
    const store = new ThreadKeyStore();
    store.set(threadPk, threadSk);
    const realBuckets = computeRealBuckets(store, windowId, null, []);
    const bucketSet = generateBucketSet(realBuckets);

    const wrapBucket = tagToBucket(
      (wrap.tags.find((t: string[]) => t[0] === 'bucket') as string[])[1],
    );
    expect(bucketSet).toContain(wrapBucket);

    // Trial decryption succeeds
    const result = tryUnwrapMessage(wrap, store);
    expect(result).not.toBeNull();
    expect(result!.rumor.content).toBe('Round trip test');
  });

  it('a handoff wrapped for granter+recipient lands in their computed bucket', () => {
    const threadSk = generateSecretKey();
    const granterSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const windowId = 2000;

    const wrap = wrapKeyHandoff(threadSk, granterSk, recipientPk, windowId);

    // The handoff bucket matches what the recipient would compute
    const store = new ThreadKeyStore();
    const realBuckets = computeRealBuckets(
      store,
      windowId,
      recipientSk,
      [getPublicKey(granterSk)],
    );
    const bucketSet = generateBucketSet(realBuckets);

    const wrapBucket = tagToBucket(
      (wrap.tags.find((t: string[]) => t[0] === 'bucket') as string[])[1],
    );
    expect(bucketSet).toContain(wrapBucket);

    // Recipient can unwrap the handoff
    const handoff = tryUnwrapHandoff(wrap, recipientSk);
    expect(handoff).not.toBeNull();
    expect(handoff!.threadPubkey).toBe(getPublicKey(threadSk));
  });

  it('bucket set always has exactly K entries', () => {
    const store = new ThreadKeyStore();
    for (let i = 0; i < 5; i++) {
      const sk = generateSecretKey();
      store.set(getPublicKey(sk), sk);
    }

    const recipientSk = generateSecretKey();
    const granterPks = [getPublicKey(generateSecretKey()), getPublicKey(generateSecretKey())];

    const real = computeRealBuckets(store, 1000, recipientSk, granterPks);
    const set = generateBucketSet(real);
    expect(set).toHaveLength(BUCKETS_PER_READER);
  });

  it('full flow: handoff received, then message decrypted with granted key', () => {
    const threadSk = generateSecretKey();
    const threadPk = getPublicKey(threadSk);
    const granterSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const authorSk = generateSecretKey();
    const windowId = 3000;

    // 1. Granter wraps the thread key for the recipient
    const handoffWrap = wrapKeyHandoff(threadSk, granterSk, recipientPk, windowId);

    // 2. Recipient unwraps the handoff
    const handoff = tryUnwrapHandoff(handoffWrap, recipientSk);
    expect(handoff).not.toBeNull();

    // 3. Recipient stores the thread key
    const store = new ThreadKeyStore();
    store.set(handoff!.threadPubkey, hexToBytes(handoff!.threadSecretHex));

    // 4. Author writes a message to the thread
    const rumor: ThreadRumor = {
      kind: 1111,
      pubkey: getPublicKey(authorSk),
      content: 'Message after handoff',
      tags: [['subject', 'Welcome']],
      created_at: Math.floor(Date.now() / 1000),
    };
    const msgWrap = wrapThreadMessage(rumor, threadSk, windowId);

    // 5. Recipient decrypts the message using the granted key
    const result = tryUnwrapMessage(msgWrap, store);
    expect(result).not.toBeNull();
    expect(result!.rumor.content).toBe('Message after handoff');
    expect(result!.threadPubkey).toBe(threadPk);
  });
});
