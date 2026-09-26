/**
 * Cross-implementation test vectors.
 *
 * Each value below was computed by the kit's Python (thread_wrap.py) and must
 * match byte-for-byte, or the two sides cannot interoperate.
 */
import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import {
  computeThreadBucket,
  computeHandoffBucket,
  ecdhHex,
  getWindowId,
  expiryTimestamp,
  WINDOW_SECONDS,
} from './bucketCrypto';
import { wrapThreadMessage, tryUnwrapMessage, wrapKeyHandoff, tryUnwrapHandoff } from './giftWrap';
import { ThreadKeyStore } from './threadKeyStore';

describe('cross-implementation: pure function vectors', () => {
  it('thread bucket: sha256("a"*64 + "20000")[0] == 0x05', () => {
    expect(computeThreadBucket('a'.repeat(64), 20000)).toBe('05');
  });

  it('handoff bucket: sha256("b"*64 + "handoff" + "20000")[0] == 0xbd', () => {
    expect(computeHandoffBucket('b'.repeat(64), 20000)).toBe('bd');
  });

  it('ECDH: sha256(ECDH(sk=1, G).x) matches kit', () => {
    const sk = new Uint8Array(32);
    sk[31] = 1;
    const gx = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    expect(ecdhHex(sk, gx)).toBe(
      '132f39a98c31baaddba6525f5d43f2954472097fa15265f45130bfdb70e51def',
    );
  });

  it('handoff bucket from ECDH(sk=1, G) at window 20000 == 0xee', () => {
    const sk = new Uint8Array(32);
    sk[31] = 1;
    const gx = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const ecdh = ecdhHex(sk, gx);
    expect(computeHandoffBucket(ecdh, 20000)).toBe('ee');
  });

  it('window: floor(1727222400 / 86400) == 19991', () => {
    expect(getWindowId(1727222400)).toBe(19991);
  });

  it('expiry: (19991+2)*86400 == 1727395200', () => {
    expect(expiryTimestamp(19991)).toBe(1727395200);
  });
});

describe('cross-implementation: inner payload format', () => {
  it('message inner is JSON {p, a}', () => {
    const threadSk = generateSecretKey();
    const threadHex = bytesToHex(threadSk);
    const threadPk = getPublicKey(threadSk);
    const authorPk = getPublicKey(generateSecretKey());
    const now = 1727222400 + 43200;

    const wrap = wrapThreadMessage('hello world', authorPk, threadHex, now);

    // Manually decrypt to verify inner format
    const conversationKey = nip44.v2.utils.getConversationKey(threadSk, wrap.pubkey);
    const decrypted = nip44.v2.decrypt(wrap.content, conversationKey);
    const inner = JSON.parse(decrypted);
    expect(inner).toEqual({ p: 'hello world', a: authorPk });
  });

  it('handoff inner is JSON {tid, sec, g}', () => {
    const threadSk = generateSecretKey();
    const threadHex = bytesToHex(threadSk);
    const granterSk = generateSecretKey();
    const granterPk = getPublicKey(granterSk);
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const now = 1727222400 + 43200;

    const wrap = wrapKeyHandoff('test-thread', threadHex, granterSk, recipientPk, now);

    // Manually decrypt: handoff is encrypted from one-time key to recipient
    const conversationKey = nip44.v2.utils.getConversationKey(recipientSk, wrap.pubkey);
    const decrypted = nip44.v2.decrypt(wrap.content, conversationKey);
    const inner = JSON.parse(decrypted);
    expect(inner).toEqual({
      tid: 'test-thread',
      sec: threadHex,
      g: granterPk,
    });
  });
});

describe('cross-implementation: tag format', () => {
  it('wrap has exactly [t, bucket] and [expiration, value] tags', () => {
    const threadSk = generateSecretKey();
    const now = 1727222400 + 43200;
    const wrap = wrapThreadMessage(
      'test', getPublicKey(generateSecretKey()), bytesToHex(threadSk), now,
    );

    expect(wrap.tags).toHaveLength(2);
    expect(wrap.tags[0][0]).toBe('t');
    expect(wrap.tags[0][1]).toMatch(/^[0-9a-f]{2}$/);
    expect(wrap.tags[1][0]).toBe('expiration');

    const wid = getWindowId(now);
    expect(wrap.tags[1][1]).toBe(String((wid + 2) * WINDOW_SECONDS));
  });
});
