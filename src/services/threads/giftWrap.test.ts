import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent, nip44 } from 'nostr-tools';
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

describe('tryUnwrapMessage: the time a message was sent', () => {
  // The wrap's created_at is randomised back toward the start of its window on
  // purpose, so it can sit up to a day before the real send time. The real time
  // travels inside the seal, as `ts`.
  const threadSk = generateSecretKey();
  const threadSecretHex = bytesToHex(threadSk);
  const threadPubkey = getPublicKey(threadSk);
  const authorPk = getPublicKey(generateSecretKey());
  const now = 1727222400 + 43200;
  const windowStart = getWindowId(now) * WINDOW_SECONDS;
  const store = new ThreadKeyStore();
  store.set(threadPubkey, threadSk);

  /** A wrap whose sealed payload is exactly `inner`, as the kit or anyone holding the key might write it. */
  function wrapInner(inner: Record<string, unknown>, outerAt: number) {
    const oneTimeSk = generateSecretKey();
    const ck = nip44.v2.utils.getConversationKey(oneTimeSk, threadPubkey);
    return { id: 'e'.repeat(64), pubkey: getPublicKey(oneTimeSk), content: nip44.v2.encrypt(JSON.stringify(inner), ck), tags: [], created_at: outerAt };
  }

  it('reads at the time it was sent, not the wrap’s randomised time', () => {
    const wrap = { ...wrapThreadMessage('hello', authorPk, threadSecretHex, now), created_at: windowStart };
    const msg = tryUnwrapMessage(wrap, store)!;
    expect(msg.createdAt).toBe(now);
    expect(msg.approxTime).toBe(false);
  });

  // With no usable ts, the send time lies between the wrap's randomised time and
  // the end of its window (or now, if the window is still open). Space uses the
  // LATEST possible time: the randomised one can be the evening before in local
  // time, and an untimed message must never sort above timed ones sent after it.
  const windowEnd = windowStart + WINDOW_SECONDS - 1;

  it('with no time inside (the kit’s format), takes the latest possible send time and says it is approximate', () => {
    const msg = tryUnwrapMessage(wrapInner({ p: 'x', a: authorPk }, windowStart + 5), store)!;
    expect(msg.createdAt).toBe(windowEnd);
    expect(msg.approxTime).toBe(true);
  });

  it('while its window is still open, the latest possible send time is now, never the future', () => {
    const readAt = windowStart + 500;
    const msg = tryUnwrapMessage(wrapInner({ p: 'x', a: authorPk }, windowStart + 5), store, readAt)!;
    expect(msg.createdAt).toBe(readAt);
    expect(msg.approxTime).toBe(true);
  });

  it.each([
    ['earlier than the wrap, which the randomising never produces', windowStart + 99],
    ['in another window', windowStart + 100 + WINDOW_SECONDS],
    ['not a whole number', windowStart + 200.5],
    ['a string', String(windowStart + 200)],
  ])('ignores a claimed time %s', (_why, ts) => {
    const msg = tryUnwrapMessage(wrapInner({ p: 'x', a: authorPk, ts }, windowStart + 100), store)!;
    expect(msg.createdAt).toBe(windowEnd);
    expect(msg.approxTime).toBe(true);
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
