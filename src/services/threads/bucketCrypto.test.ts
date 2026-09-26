/**
 * @fileoverview Tests for bucket computation primitives.
 */

import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey as getPublicKeyDirect, nip44 } from 'nostr-tools';
import {
  BUCKET_BITS,
  WINDOW_SECONDS,
  BUCKETS_PER_READER,
  getWindowId,
  computeThreadBucket,
  computeHandoffBucket,
  generateBucketSet,
  bucketToTag,
  tagToBucket,
  jitteredTimestamp,
} from './bucketCrypto';

describe('getWindowId', () => {
  it('returns the same value for two timestamps in the same 24h window', () => {
    const midnight = 1727222400; // some midnight UTC
    expect(getWindowId(midnight)).toBe(getWindowId(midnight + 3600));
    expect(getWindowId(midnight)).toBe(getWindowId(midnight + 86399));
  });

  it('returns different values for timestamps in different windows', () => {
    const midnight = 1727222400;
    expect(getWindowId(midnight)).not.toBe(getWindowId(midnight + 86400));
  });

  it('returns epoch day number', () => {
    expect(getWindowId(0)).toBe(0);
    expect(getWindowId(86400)).toBe(1);
    expect(getWindowId(86400 * 100)).toBe(100);
  });
});

describe('computeThreadBucket', () => {
  const threadSk = generateSecretKey();

  it('returns a value in [0, 255] for B=8', () => {
    const bucket = computeThreadBucket(threadSk, 1000);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(1 << BUCKET_BITS);
  });

  it('is deterministic: same inputs produce the same bucket', () => {
    const a = computeThreadBucket(threadSk, 1000);
    const b = computeThreadBucket(threadSk, 1000);
    expect(a).toBe(b);
  });

  it('changes when the window changes', () => {
    // With high probability, different windows produce different buckets
    // for the same thread. Test over 10 windows to avoid false failures.
    const buckets = new Set<number>();
    for (let w = 0; w < 10; w++) {
      buckets.add(computeThreadBucket(threadSk, w));
    }
    expect(buckets.size).toBeGreaterThan(1);
  });

  it('different threads produce different buckets (usually)', () => {
    const other = generateSecretKey();
    const buckets = new Set<number>();
    for (let w = 0; w < 10; w++) {
      buckets.add(computeThreadBucket(threadSk, w));
      buckets.add(computeThreadBucket(other, w));
    }
    expect(buckets.size).toBeGreaterThan(2);
  });
});

describe('computeHandoffBucket', () => {
  it('returns a value in [0, 255]', () => {
    const shared = new Uint8Array(32);
    globalThis.crypto.getRandomValues(shared);
    const bucket = computeHandoffBucket(shared, 1000);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(1 << BUCKET_BITS);
  });

  it('is deterministic', () => {
    const shared = new Uint8Array(32);
    globalThis.crypto.getRandomValues(shared);
    expect(computeHandoffBucket(shared, 500)).toBe(computeHandoffBucket(shared, 500));
  });

  it('ECDH is symmetric: both parties compute the same bucket', () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const aliceSide = nip44.v2.utils.getConversationKey(alice, getPublicKeyDirect(bob));
    const bobSide = nip44.v2.utils.getConversationKey(bob, getPublicKeyDirect(alice));

    const windowId = 2000;
    expect(computeHandoffBucket(aliceSide, windowId)).toBe(
      computeHandoffBucket(bobSide, windowId),
    );
  });
});

describe('generateBucketSet', () => {
  it('always returns exactly K buckets', () => {
    const set = generateBucketSet([10, 20, 30]);
    expect(set).toHaveLength(BUCKETS_PER_READER);
  });

  it('includes all real buckets', () => {
    const real = [10, 20, 30];
    const set = generateBucketSet(real);
    for (const b of real) {
      expect(set).toContain(b);
    }
  });

  it('pads up from zero real buckets', () => {
    const set = generateBucketSet([]);
    expect(set).toHaveLength(BUCKETS_PER_READER);
  });

  it('handles more real buckets than K by including all', () => {
    const real = Array.from({ length: 20 }, (_, i) => i);
    const set = generateBucketSet(real);
    // All 20 real buckets must be present, even though K=16
    for (const b of real) {
      expect(set).toContain(b);
    }
  });

  it('all values are in [0, 255]', () => {
    const set = generateBucketSet([5]);
    for (const b of set) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(256);
    }
  });
});

describe('bucketToTag / tagToBucket', () => {
  it('round-trips', () => {
    for (const n of [0, 1, 15, 16, 127, 255]) {
      expect(tagToBucket(bucketToTag(n))).toBe(n);
    }
  });

  it('produces 2-char hex', () => {
    expect(bucketToTag(0)).toBe('00');
    expect(bucketToTag(15)).toBe('0f');
    expect(bucketToTag(255)).toBe('ff');
  });
});

describe('jitteredTimestamp', () => {
  it('falls within the window', () => {
    const windowId = 20000;
    const windowStart = windowId * WINDOW_SECONDS;
    const windowEnd = windowStart + WINDOW_SECONDS;

    for (let i = 0; i < 20; i++) {
      const ts = jitteredTimestamp(windowId);
      expect(ts).toBeGreaterThanOrEqual(windowStart);
      expect(ts).toBeLessThan(windowEnd);
    }
  });
});
