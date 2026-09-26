import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';
import {
  wrapThreadMessage,
  wrapKeyHandoff,
  tryUnwrapMessage,
  tryUnwrapHandoff,
  GIFT_WRAP_KIND,
} from './giftWrap';
import { ThreadKeyStore } from './threadKeyStore';
import { getWindowId, computeThreadBucket, computeHandoffBucket, ecdhHex } from './bucketCrypto';

describe('writer: wrapThreadMessage produces a publishable event', () => {
  const threadSk = generateSecretKey();
  const threadHex = bytesToHex(threadSk);
  const authorPk = getPublicKey(generateSecretKey());
  const now = 1727222400 + 43200;

  it('event has all required fields for NDK publish', () => {
    const wrap = wrapThreadMessage('test', authorPk, threadHex, now);
    expect(wrap.id).toMatch(/^[0-9a-f]{64}$/);
    expect(wrap.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(wrap.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(wrap.kind).toBe(GIFT_WRAP_KIND);
    expect(wrap.content).toBeTruthy();
    expect(wrap.tags).toHaveLength(2);
    expect(wrap.created_at).toBeGreaterThan(0);
  });

  it('event signature is valid', () => {
    const wrap = wrapThreadMessage('test', authorPk, threadHex, now);
    expect(verifyEvent(wrap)).toBe(true);
  });

  it('bucket tag matches the thread+window computation', () => {
    const windowId = getWindowId(now);
    const wrap = wrapThreadMessage('test', authorPk, threadHex, now);
    const expected = computeThreadBucket(threadHex, windowId);
    const actual = wrap.tags.find((t: string[]) => t[0] === 't')?.[1];
    expect(actual).toBe(expected);
  });

  it('reader can decrypt what the writer wraps', () => {
    const wrap = wrapThreadMessage('from writer', authorPk, threadHex, now);
    const store = new ThreadKeyStore();
    store.set(getPublicKey(threadSk), threadSk);
    const result = tryUnwrapMessage(wrap, store);
    expect(result).not.toBeNull();
    expect(result!.plaintext).toBe('from writer');
  });
});

describe('writer: wrapKeyHandoff produces a publishable event', () => {
  const threadSk = generateSecretKey();
  const threadHex = bytesToHex(threadSk);
  const granterSk = generateSecretKey();
  const recipientSk = generateSecretKey();
  const recipientPk = getPublicKey(recipientSk);
  const now = 1727222400 + 43200;

  it('event has all required fields for NDK publish', () => {
    const wrap = wrapKeyHandoff('t1', threadHex, granterSk, recipientPk, now);
    expect(wrap.id).toMatch(/^[0-9a-f]{64}$/);
    expect(wrap.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(wrap.kind).toBe(GIFT_WRAP_KIND);
  });

  it('event signature is valid', () => {
    const wrap = wrapKeyHandoff('t1', threadHex, granterSk, recipientPk, now);
    expect(verifyEvent(wrap)).toBe(true);
  });

  it('bucket tag matches the ECDH handoff computation', () => {
    const windowId = getWindowId(now);
    const wrap = wrapKeyHandoff('t1', threadHex, granterSk, recipientPk, now);
    const ecdh = ecdhHex(granterSk, recipientPk);
    const expected = computeHandoffBucket(ecdh, windowId);
    const actual = wrap.tags.find((t: string[]) => t[0] === 't')?.[1];
    expect(actual).toBe(expected);
  });

  it('recipient can unwrap and recover the thread key', () => {
    const wrap = wrapKeyHandoff('t1', threadHex, granterSk, recipientPk, now);
    const handoff = tryUnwrapHandoff(wrap, recipientSk);
    expect(handoff).not.toBeNull();
    expect(handoff!.threadSecretHex).toBe(threadHex);
  });
});
