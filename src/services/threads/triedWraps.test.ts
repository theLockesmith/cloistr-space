import { describe, it, expect, beforeEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import {
  isNotAddressedToUs,
  wrapVerifies,
  wrapExpiry,
  openTriedWraps,
  forgetOtherUsers,
  clearTriedWraps,
  type SelfCrypt,
} from './triedWraps';

const aliceSk = generateSecretKey();
const alice = getPublicKey(aliceSk);
const bob = 'b'.repeat(64);

/** NIP-44 to self, as the signer does for the thread keys. */
function selfCrypt(sk: Uint8Array): SelfCrypt {
  const ck = (pk: string) => nip44.v2.utils.getConversationKey(sk, pk);
  return {
    encrypt: async (pk, pt) => nip44.v2.encrypt(pt, ck(pk)),
    decrypt: async (pk, ct) => nip44.v2.decrypt(ct, ck(pk)),
  };
}

beforeEach(() => localStorage.clear());

describe('isNotAddressedToUs', () => {
  it('is true for the signer saying the MAC did not match, and for nostr-tools saying the same', () => {
    expect(isNotAddressedToUs(new Error('Failed to nip44-decrypt message: decryption failed: invalid hmac'))).toBe(true);
    expect(isNotAddressedToUs(new Error('invalid MAC'))).toBe(true);
  });

  it('is false for a timeout, a refusal, the signer being unreachable, or "invalid mac" inside other text', () => {
    expect(isNotAddressedToUs(new Error('Failed to nip44-decrypt message: Request timed out after 30000ms'))).toBe(false);
    expect(isNotAddressedToUs(new Error('Failed to nip44-decrypt message: permission denied'))).toBe(false);
    expect(isNotAddressedToUs(new Error('No relay connections available'))).toBe(false);
    expect(isNotAddressedToUs(new Error('refused: invalid mac address policy, try later'))).toBe(false);
  });
});

describe('wrapVerifies', () => {
  const signed = finalizeEvent({ kind: 1059, content: 'x', tags: [], created_at: 1000 }, generateSecretKey());

  it('accepts a wrap exactly as signed', () => {
    expect(wrapVerifies(signed)).toBe(true);
  });

  it('refuses a copy under the same id with other content, even after the original was checked', () => {
    expect(wrapVerifies(signed)).toBe(true);
    expect(wrapVerifies({ ...signed, content: 'y' })).toBe(false);
  });
});

describe('the tried list', () => {
  it('remembers a wrap for its user until it expires, across a reload', async () => {
    let t = 1000;
    const first = await openTriedWraps(alice, selfCrypt(aliceSk), () => t);
    first.record('w1', 2000);
    await first.flush();
    const second = await openTriedWraps(alice, selfCrypt(aliceSk), () => t);
    expect(second.has('w1')).toBe(true);
    t = 2000;
    expect(second.has('w1')).toBe(false);
  });

  it('does not store wrap ids readably', async () => {
    const list = await openTriedWraps(alice, selfCrypt(aliceSk), () => 1000);
    list.record('wrap-id-that-must-not-show', 2000);
    await list.flush();
    expect(localStorage.getItem('cloistr:tried-wraps:' + alice)).not.toContain('wrap-id-that-must-not-show');
  });

  it('is kept per user', async () => {
    const a = await openTriedWraps(alice, selfCrypt(aliceSk), () => 1000);
    a.record('w1', 2000);
    await a.flush();
    const b = await openTriedWraps(bob, selfCrypt(generateSecretKey()), () => 1000);
    expect(b.has('w1')).toBe(false);
  });

  it('drops expired wraps when it next writes', async () => {
    let t = 1000;
    const list = await openTriedWraps(alice, selfCrypt(aliceSk), () => t);
    list.record('old', 1100);
    t = 2000;
    list.record('new', 3000);
    await list.flush();
    const blob = localStorage.getItem('cloistr:tried-wraps:' + alice)!;
    expect(Object.keys(JSON.parse(await selfCrypt(aliceSk).decrypt(alice, blob)))).toEqual(['new']);
  });

  it('starts empty when the stored list cannot be read', async () => {
    localStorage.setItem('cloistr:tried-wraps:' + alice, 'garbage');
    const list = await openTriedWraps(alice, selfCrypt(aliceSk), () => 1000);
    expect(list.has('w1')).toBe(false);
  });

  it('keeps only the signed-in user on account switch, and nothing after sign-out', () => {
    localStorage.setItem('cloistr:tried-wraps:' + alice, 'a');
    localStorage.setItem('cloistr:tried-wraps:' + bob, 'b');
    forgetOtherUsers(bob);
    expect(localStorage.getItem('cloistr:tried-wraps:' + alice)).toBeNull();
    expect(localStorage.getItem('cloistr:tried-wraps:' + bob)).toBe('b');
    clearTriedWraps();
    expect(localStorage.getItem('cloistr:tried-wraps:' + bob)).toBeNull();
  });
});

describe('wrapExpiry', () => {
  it('uses the expiration tag, else a few days past creation', () => {
    expect(wrapExpiry({ tags: [['expiration', '5000']], created_at: 1000 })).toBe(5000);
    expect(wrapExpiry({ tags: [], created_at: 1000 })).toBe(1000 + 3 * 86400);
  });
});
