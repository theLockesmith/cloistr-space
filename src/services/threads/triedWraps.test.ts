import { describe, it, expect, beforeEach } from 'vitest';
import {
  isNotAddressedToUs,
  wrapExpiry,
  hasTriedWrap,
  recordTriedWrap,
  forgetOtherUsers,
  clearTriedWraps,
} from './triedWraps';

const alice = 'a'.repeat(64);
const bob = 'b'.repeat(64);

beforeEach(() => localStorage.clear());

describe('isNotAddressedToUs', () => {
  it('is true for the signer saying the MAC did not match, and for nostr-tools saying the same', () => {
    expect(isNotAddressedToUs(new Error('Failed to nip44-decrypt message: decryption failed: invalid hmac'))).toBe(true);
    expect(isNotAddressedToUs(new Error('invalid MAC'))).toBe(true);
  });

  it('is false for a timeout, a refusal, or the signer being unreachable', () => {
    expect(isNotAddressedToUs(new Error('Failed to nip44-decrypt message: Request timed out after 30000ms'))).toBe(false);
    expect(isNotAddressedToUs(new Error('Failed to nip44-decrypt message: permission denied'))).toBe(false);
    expect(isNotAddressedToUs(new Error('No relay connections available'))).toBe(false);
  });
});

describe('the tried list', () => {
  it('remembers a wrap for its user until it expires', () => {
    recordTriedWrap(alice, 'w1', 2000, 1000);
    expect(hasTriedWrap(alice, 'w1', 1500)).toBe(true);
    expect(hasTriedWrap(alice, 'w1', 2000)).toBe(false);
  });

  it('is kept per user', () => {
    recordTriedWrap(alice, 'w1', 2000, 1000);
    expect(hasTriedWrap(bob, 'w1', 1500)).toBe(false);
  });

  it('drops expired wraps when it next writes', () => {
    recordTriedWrap(alice, 'old', 1100, 1000);
    recordTriedWrap(alice, 'new', 3000, 2000);
    expect(Object.keys(JSON.parse(localStorage.getItem('cloistr:tried-wraps:' + alice)!))).toEqual(['new']);
  });

  it('keeps only the signed-in user on account switch, and nothing after sign-out', () => {
    recordTriedWrap(alice, 'w1', 2000, 1000);
    recordTriedWrap(bob, 'w2', 2000, 1000);
    forgetOtherUsers(bob);
    expect(hasTriedWrap(alice, 'w1', 1500)).toBe(false);
    expect(hasTriedWrap(bob, 'w2', 1500)).toBe(true);
    clearTriedWraps();
    expect(hasTriedWrap(bob, 'w2', 1500)).toBe(false);
  });
});

describe('wrapExpiry', () => {
  it('uses the expiration tag, else a few days past creation', () => {
    expect(wrapExpiry({ tags: [['expiration', '5000']], created_at: 1000 })).toBe(5000);
    expect(wrapExpiry({ tags: [], created_at: 1000 })).toBe(1000 + 3 * 86400);
  });
});
