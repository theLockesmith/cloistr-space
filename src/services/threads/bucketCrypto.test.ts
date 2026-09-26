import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';
import {
  WINDOW_SECONDS,
  BUCKETS_PER_READER,
  getWindowId,
  computeThreadBucket,
  computeHandoffBucket,
  ecdhHex,
  generateBucketSet,
  jitteredTimestamp,
  expiryTimestamp,
} from './bucketCrypto';

describe('getWindowId', () => {
  it('returns the same value for two timestamps in the same 24h window', () => {
    const midnight = 1727222400;
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
  it('matches kit vector: sha256(hex_secret + decimal_window) first byte as 2-hex', () => {
    expect(computeThreadBucket('a'.repeat(64), 20000)).toBe('05');
  });

  it('returns a 2-char lowercase hex string', () => {
    const sk = generateSecretKey();
    const b = computeThreadBucket(bytesToHex(sk), 1000);
    expect(b).toMatch(/^[0-9a-f]{2}$/);
  });

  it('is deterministic', () => {
    const hex = bytesToHex(generateSecretKey());
    expect(computeThreadBucket(hex, 1000)).toBe(computeThreadBucket(hex, 1000));
  });

  it('changes when the window changes', () => {
    const hex = bytesToHex(generateSecretKey());
    const buckets = new Set<string>();
    for (let w = 0; w < 10; w++) {
      buckets.add(computeThreadBucket(hex, w));
    }
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe('ecdhHex', () => {
  it('matches kit vector: sha256(ECDH x-coordinate) as 64-hex', () => {
    const sk = new Uint8Array(32);
    sk[31] = 1;
    const gx = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    expect(ecdhHex(sk, gx)).toBe(
      '132f39a98c31baaddba6525f5d43f2954472097fa15265f45130bfdb70e51def',
    );
  });

  it('is symmetric: both parties compute the same value', () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    expect(ecdhHex(alice, getPublicKey(bob))).toBe(ecdhHex(bob, getPublicKey(alice)));
  });

  it('returns 64-char lowercase hex', () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(generateSecretKey());
    expect(ecdhHex(sk, pk)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeHandoffBucket', () => {
  it('matches kit vector: sha256(ecdh_hex + "handoff" + decimal_window) first byte', () => {
    expect(computeHandoffBucket('b'.repeat(64), 20000)).toBe('bd');
  });

  it('ECDH-derived: both parties compute the same handoff bucket', () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const e1 = ecdhHex(alice, getPublicKey(bob));
    const e2 = ecdhHex(bob, getPublicKey(alice));
    expect(computeHandoffBucket(e1, 2000)).toBe(computeHandoffBucket(e2, 2000));
  });
});

describe('generateBucketSet', () => {
  it('always returns exactly K buckets', () => {
    const set = generateBucketSet(['0a', '1b', '2c']);
    expect(set).toHaveLength(BUCKETS_PER_READER);
  });

  it('includes all real buckets', () => {
    const real = ['0a', '1b', '2c'];
    const set = generateBucketSet(real);
    for (const b of real) {
      expect(set).toContain(b);
    }
  });

  it('pads up from zero real buckets', () => {
    const set = generateBucketSet([]);
    expect(set).toHaveLength(BUCKETS_PER_READER);
  });

  it('all values are 2-char hex', () => {
    const set = generateBucketSet(['05']);
    for (const b of set) {
      expect(b).toMatch(/^[0-9a-f]{2}$/);
    }
  });
});

describe('jitteredTimestamp', () => {
  it('falls between window start and the given timestamp', () => {
    const now = 1727222400 + 43200; // midday
    const windowStart = getWindowId(now) * WINDOW_SECONDS;
    for (let i = 0; i < 20; i++) {
      const ts = jitteredTimestamp(now);
      expect(ts).toBeGreaterThanOrEqual(windowStart);
      expect(ts).toBeLessThanOrEqual(now);
    }
  });

  it('returns window start when timestamp is exactly at window start', () => {
    const windowStart = 20000 * WINDOW_SECONDS;
    expect(jitteredTimestamp(windowStart)).toBe(windowStart);
  });
});

describe('expiryTimestamp', () => {
  it('is 2 windows after the given window', () => {
    expect(expiryTimestamp(20000)).toBe(20002 * WINDOW_SECONDS);
  });
});
