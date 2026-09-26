import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import { ThreadKeyStore } from './threadKeyStore';
import { computeRealBuckets } from './useBucketReader';
import {
  computeThreadBucket,
  computeHandoffBucket,
  ecdhHex,
  BUCKETS_PER_READER,
  generateBucketSet,
} from './bucketCrypto';
import {
  wrapThreadMessage,
  wrapKeyHandoff,
  tryUnwrapMessage,
  tryUnwrapHandoff,
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

    expect(buckets).toContain(computeThreadBucket(bytesToHex(sk1), windowId));
    expect(buckets).toContain(computeThreadBucket(bytesToHex(sk2), windowId));
  });

  it('includes handoff buckets when recipientSecret is provided', () => {
    const store = new ThreadKeyStore();
    const recipientSk = generateSecretKey();
    const granterSk = generateSecretKey();
    const granterPk = getPublicKey(granterSk);
    const windowId = 1000;

    const ecdh = ecdhHex(recipientSk, granterPk);
    const expected = computeHandoffBucket(ecdh, windowId);

    const buckets = computeRealBuckets(store, windowId, recipientSk, [granterPk]);
    expect(buckets).toContain(expected);
  });

  it('returns empty when store is empty and no granters', () => {
    const store = new ThreadKeyStore();
    expect(computeRealBuckets(store, 1000, null, [])).toEqual([]);
  });

  it('deduplicates collisions', () => {
    const store = new ThreadKeyStore();
    const sk = generateSecretKey();
    store.set(getPublicKey(sk), sk);
    const buckets = computeRealBuckets(store, 1000, generateSecretKey(), [getPublicKey(generateSecretKey())]);
    const unique = new Set(buckets);
    expect(buckets.length).toBe(unique.size);
  });
});

describe('bucket reader round trip', () => {
  it('a message lands in its computed bucket and decrypts', () => {
    const threadSk = generateSecretKey();
    const threadHex = bytesToHex(threadSk);
    const threadPk = getPublicKey(threadSk);
    const authorPk = getPublicKey(generateSecretKey());
    const now = 1727222400 + 43200;
    const windowId = Math.floor(now / 86400);

    const wrap = wrapThreadMessage('round trip', authorPk, threadHex, now);

    const store = new ThreadKeyStore();
    store.set(threadPk, threadSk);
    const realBuckets = computeRealBuckets(store, windowId, null, []);
    const bucketSet = generateBucketSet(realBuckets);

    const wrapBucket = wrap.tags.find((t: string[]) => t[0] === 't')![1];
    expect(bucketSet).toContain(wrapBucket);

    const result = tryUnwrapMessage(wrap, store);
    expect(result).not.toBeNull();
    expect(result!.plaintext).toBe('round trip');
  });

  it('a handoff lands in the granter-recipient computed bucket', () => {
    const threadSk = generateSecretKey();
    const threadHex = bytesToHex(threadSk);
    const granterSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const now = 1727222400 + 43200;
    const windowId = Math.floor(now / 86400);

    const wrap = wrapKeyHandoff('t1', threadHex, granterSk, recipientPk, now);

    const store = new ThreadKeyStore();
    const realBuckets = computeRealBuckets(
      store, windowId, recipientSk, [getPublicKey(granterSk)],
    );
    const bucketSet = generateBucketSet(realBuckets);

    const wrapBucket = wrap.tags.find((t: string[]) => t[0] === 't')![1];
    expect(bucketSet).toContain(wrapBucket);

    const handoff = tryUnwrapHandoff(wrap, recipientSk);
    expect(handoff).not.toBeNull();
    expect(handoff!.threadId).toBe('t1');
  });

  it('bucket set always has exactly K entries', () => {
    const store = new ThreadKeyStore();
    for (let i = 0; i < 5; i++) {
      const sk = generateSecretKey();
      store.set(getPublicKey(sk), sk);
    }
    const real = computeRealBuckets(store, 1000, generateSecretKey(), [getPublicKey(generateSecretKey())]);
    expect(generateBucketSet(real)).toHaveLength(BUCKETS_PER_READER);
  });

  it('full flow: handoff then message decrypted with granted key', () => {
    const threadSk = generateSecretKey();
    const threadHex = bytesToHex(threadSk);
    const granterSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const authorPk = getPublicKey(generateSecretKey());
    const now = 1727222400 + 43200;

    const handoffWrap = wrapKeyHandoff('t1', threadHex, granterSk, recipientPk, now);
    const handoff = tryUnwrapHandoff(handoffWrap, recipientSk)!;
    expect(handoff).not.toBeNull();

    const store = new ThreadKeyStore();
    store.set(getPublicKey(hexToBytes(handoff.threadSecretHex)), hexToBytes(handoff.threadSecretHex));

    const msgWrap = wrapThreadMessage('after handoff', authorPk, threadHex, now);
    const result = tryUnwrapMessage(msgWrap, store);
    expect(result).not.toBeNull();
    expect(result!.plaintext).toBe('after handoff');
  });
});
