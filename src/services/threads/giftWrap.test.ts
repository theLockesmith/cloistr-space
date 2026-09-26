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
} from './giftWrap';
import { getWindowId, WINDOW_SECONDS, expiryTimestamp } from './bucketCrypto';

describe('wrapThreadMessage', () => {
  const threadSk = generateSecretKey();
  const threadSecretHex = bytesToHex(threadSk);
  const authorPk = getPublicKey(generateSecretKey());
  const now = 1727222400 + 43200;

  it('produces a kind 1059 event', () => {
    const wrap = wrapThreadMessage('hello', authorPk, threadSecretHex, now);
    expect(wrap.kind).toBe(GIFT_WRAP_KIND);
  });

  it('is signed by a one-time key, not the author', () => {
    const wrap = wrapThreadMessage('hello', authorPk, threadSecretHex, now);
    expect(wrap.pubkey).not.toBe(authorPk);
    expect(verifyEvent(wrap)).toBe(true);
  });

  it('carries exactly t and expiration tags', () => {
    const wrap = wrapThreadMessage('hello', authorPk, threadSecretHex, now);
    const tagNames = wrap.tags.map((t: string[]) => t[0]).sort();
    expect(tagNames).toEqual(['expiration', 't']);
  });

  it('t tag is a 2-char hex bucket value', () => {
    const wrap = wrapThreadMessage('hello', authorPk, threadSecretHex, now);
    const tTag = wrap.tags.find((t: string[]) => t[0] === 't');
    expect(tTag![1]).toMatch(/^[0-9a-f]{2}$/);
  });

  it('expiration tag is (window+2)*86400', () => {
    const wrap = wrapThreadMessage('hello', authorPk, threadSecretHex, now);
    const expTag = wrap.tags.find((t: string[]) => t[0] === 'expiration');
    const wid = getWindowId(now);
    expect(expTag![1]).toBe(String(expiryTimestamp(wid)));
  });

  it('uses a different one-time key each time', () => {
    const a = wrapThreadMessage('hello', authorPk, threadSecretHex, now);
    const b = wrapThreadMessage('hello', authorPk, threadSecretHex, now);
    expect(a.pubkey).not.toBe(b.pubkey);
  });

  it('timestamp falls between window start and now', () => {
    const wrap = wrapThreadMessage('hello', authorPk, threadSecretHex, now);
    const windowStart = getWindowId(now) * WINDOW_SECONDS;
    expect(wrap.created_at).toBeGreaterThanOrEqual(windowStart);
    expect(wrap.created_at).toBeLessThanOrEqual(now);
  });

  it('carries no p, h, thread, or author tags', () => {
    const wrap = wrapThreadMessage('hello', authorPk, threadSecretHex, now);
    const tagNames = wrap.tags.map((t: string[]) => t[0]);
    expect(tagNames).not.toContain('p');
    expect(tagNames).not.toContain('h');
    expect(tagNames).not.toContain('thread');
  });
});

describe('tryUnwrapMessage', () => {
  const threadSk = generateSecretKey();
  const threadSecretHex = bytesToHex(threadSk);
  const threadPubkey = getPublicKey(threadSk);
  const authorPk = getPublicKey(generateSecretKey());
  const now = 1727222400 + 43200;

  it('ADMISSION: member with the thread key decrypts the message', () => {
    const wrap = wrapThreadMessage('sealed content', authorPk, threadSecretHex, now);
    const store = new ThreadKeyStore();
    store.set(threadPubkey, threadSk);

    const result = tryUnwrapMessage(wrap, store);
    expect(result).not.toBeNull();
    expect(result!.plaintext).toBe('sealed content');
    expect(result!.authorHex).toBe(authorPk);
    expect(result!.threadId).toBe(threadPubkey);
  });

  it('NEGATIVE: bystander without the thread key gets null', () => {
    const wrap = wrapThreadMessage('sealed', authorPk, threadSecretHex, now);
    const store = new ThreadKeyStore();
    const otherSk = generateSecretKey();
    store.set(getPublicKey(otherSk), otherSk);

    expect(tryUnwrapMessage(wrap, store)).toBeNull();
  });

  it('NEGATIVE: empty key store gets null', () => {
    const wrap = wrapThreadMessage('sealed', authorPk, threadSecretHex, now);
    expect(tryUnwrapMessage(wrap, new ThreadKeyStore())).toBeNull();
  });

  it('finds the right key among many', () => {
    const wrap = wrapThreadMessage('target', authorPk, threadSecretHex, now);
    const store = new ThreadKeyStore();
    for (let i = 0; i < 5; i++) {
      const sk = generateSecretKey();
      store.set(getPublicKey(sk), sk);
    }
    store.set(threadPubkey, threadSk);

    const result = tryUnwrapMessage(wrap, store);
    expect(result).not.toBeNull();
    expect(result!.plaintext).toBe('target');
  });
});

describe('wrapKeyHandoff', () => {
  const threadSk = generateSecretKey();
  const threadSecretHex = bytesToHex(threadSk);
  const granterSk = generateSecretKey();
  const granterPk = getPublicKey(granterSk);
  const recipientSk = generateSecretKey();
  const recipientPk = getPublicKey(recipientSk);
  const now = 1727222400 + 43200;

  it('produces a kind 1059 event with t and expiration tags', () => {
    const wrap = wrapKeyHandoff('thread-1', threadSecretHex, granterSk, recipientPk, now);
    expect(wrap.kind).toBe(GIFT_WRAP_KIND);
    const tagNames = wrap.tags.map((t: string[]) => t[0]).sort();
    expect(tagNames).toEqual(['expiration', 't']);
  });

  it('is signed by a one-time key, not the granter', () => {
    const wrap = wrapKeyHandoff('thread-1', threadSecretHex, granterSk, recipientPk, now);
    expect(wrap.pubkey).not.toBe(granterPk);
    expect(verifyEvent(wrap)).toBe(true);
  });

  it('carries no p tag (recipient is hidden)', () => {
    const wrap = wrapKeyHandoff('thread-1', threadSecretHex, granterSk, recipientPk, now);
    expect(wrap.tags.filter((t: string[]) => t[0] === 'p')).toHaveLength(0);
  });
});

describe('tryUnwrapHandoff', () => {
  const threadSk = generateSecretKey();
  const threadSecretHex = bytesToHex(threadSk);
  const granterSk = generateSecretKey();
  const granterPk = getPublicKey(granterSk);
  const recipientSk = generateSecretKey();
  const recipientPk = getPublicKey(recipientSk);
  const now = 1727222400 + 43200;

  it('ADMISSION: recipient unwraps the thread key and tid', () => {
    const wrap = wrapKeyHandoff('my-thread', threadSecretHex, granterSk, recipientPk, now);
    const result = tryUnwrapHandoff(wrap, recipientSk);
    expect(result).not.toBeNull();
    expect(result!.threadId).toBe('my-thread');
    expect(result!.threadSecretHex).toBe(threadSecretHex);
    expect(result!.granterPubkey).toBe(granterPk);
  });

  it('NEGATIVE: bystander cannot unwrap', () => {
    const wrap = wrapKeyHandoff('t1', threadSecretHex, granterSk, recipientPk, now);
    const bystander = generateSecretKey();
    expect(tryUnwrapHandoff(wrap, bystander)).toBeNull();
  });

  it('rejects when granter does not match expected list', () => {
    const wrap = wrapKeyHandoff('t1', threadSecretHex, granterSk, recipientPk, now);
    const otherPk = getPublicKey(generateSecretKey());
    expect(tryUnwrapHandoff(wrap, recipientSk, [otherPk])).toBeNull();
  });

  it('accepts when granter is in the expected list', () => {
    const wrap = wrapKeyHandoff('t1', threadSecretHex, granterSk, recipientPk, now);
    const result = tryUnwrapHandoff(wrap, recipientSk, [granterPk]);
    expect(result).not.toBeNull();
  });

  it('unwrapped key decrypts thread messages', () => {
    const wrap = wrapKeyHandoff('t1', threadSecretHex, granterSk, recipientPk, now);
    const handoff = tryUnwrapHandoff(wrap, recipientSk)!;

    const store = new ThreadKeyStore();
    store.set(getPublicKey(hexToBytes(handoff.threadSecretHex)), hexToBytes(handoff.threadSecretHex));

    const authorPk = getPublicKey(generateSecretKey());
    const msgWrap = wrapThreadMessage('post-handoff', authorPk, threadSecretHex, now);
    const result = tryUnwrapMessage(msgWrap, store);
    expect(result).not.toBeNull();
    expect(result!.plaintext).toBe('post-handoff');
  });

  it('NEGATIVE: removed member cannot read post-rotation messages', () => {
    const oldSk = threadSk;
    const newSk = generateSecretKey();
    const store = new ThreadKeyStore();
    store.set(getPublicKey(oldSk), oldSk);

    const authorPk = getPublicKey(generateSecretKey());
    const msgWrap = wrapThreadMessage('after rotation', authorPk, bytesToHex(newSk), now);
    expect(tryUnwrapMessage(msgWrap, store)).toBeNull();
  });
});
