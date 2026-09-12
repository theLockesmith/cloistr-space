import { describe, it, expect, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, nip44, utils as ntUtils } from 'nostr-tools';

const { bytesToHex } = ntUtils;
import {
  ThreadKeyStore,
  decryptThreadContent,
  encryptThreadContent,
  getThreadConversationKey,
  looksLikeNip44,
  buildKeyWrapEvent,
  KEY_WRAP_KIND,
} from './threadKeyStore';

describe('ThreadKeyStore', () => {
  let store: ThreadKeyStore;

  beforeEach(() => {
    store = new ThreadKeyStore();
  });

  it('stores and retrieves a key', () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    store.set(pk, sk);

    expect(store.has(pk)).toBe(true);
    expect(store.get(pk)).toBe(sk);
    expect(store.size).toBe(1);
  });

  it('returns undefined for an unknown thread', () => {
    expect(store.get('deadbeef')).toBeUndefined();
    expect(store.has('deadbeef')).toBe(false);
  });

  it('clear() removes all keys', () => {
    const sk1 = generateSecretKey();
    const sk2 = generateSecretKey();
    store.set(getPublicKey(sk1), sk1);
    store.set(getPublicKey(sk2), sk2);

    expect(store.size).toBe(2);
    store.clear();
    expect(store.size).toBe(0);
  });

  it('importHex / exportHex round-trips', () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const hex = bytesToHex(sk);

    store.importHex(pk, hex);
    expect(store.exportHex(pk)).toBe(hex);
  });
});

describe('thread encryption round-trip', () => {
  it('encrypts and decrypts with the same thread key', () => {
    const threadSk = generateSecretKey();
    const authorSk = generateSecretKey();
    const authorPk = getPublicKey(authorSk);

    const plaintext = 'The deploy failed because port 5432 was already bound.';
    const ciphertext = encryptThreadContent(plaintext, threadSk, authorPk);

    expect(ciphertext).not.toBe(plaintext);
    expect(typeof ciphertext).toBe('string');

    const decrypted = decryptThreadContent(ciphertext, threadSk, authorPk);
    expect(decrypted).toBe(plaintext);
  });

  it('different authors produce different ciphertexts for the same message', () => {
    const threadSk = generateSecretKey();
    const author1Pk = getPublicKey(generateSecretKey());
    const author2Pk = getPublicKey(generateSecretKey());

    const plaintext = 'Same message';
    const ct1 = encryptThreadContent(plaintext, threadSk, author1Pk);
    const ct2 = encryptThreadContent(plaintext, threadSk, author2Pk);

    // Different conversation keys → different ciphertexts
    expect(ct1).not.toBe(ct2);

    // Both decrypt correctly with the right author pubkey
    expect(decryptThreadContent(ct1, threadSk, author1Pk)).toBe(plaintext);
    expect(decryptThreadContent(ct2, threadSk, author2Pk)).toBe(plaintext);
  });

  it('wrong thread key returns null', () => {
    const threadSk = generateSecretKey();
    const wrongSk = generateSecretKey();
    const authorPk = getPublicKey(generateSecretKey());

    const ciphertext = encryptThreadContent('secret', threadSk, authorPk);
    const result = decryptThreadContent(ciphertext, wrongSk, authorPk);
    expect(result).toBeNull();
  });

  it('wrong author pubkey returns null', () => {
    const threadSk = generateSecretKey();
    const authorPk = getPublicKey(generateSecretKey());
    const wrongPk = getPublicKey(generateSecretKey());

    const ciphertext = encryptThreadContent('secret', threadSk, authorPk);
    const result = decryptThreadContent(ciphertext, threadSk, wrongPk);
    expect(result).toBeNull();
  });
});

describe('getThreadConversationKey', () => {
  it('is deterministic', () => {
    const threadSk = generateSecretKey();
    const authorPk = getPublicKey(generateSecretKey());

    const ck1 = getThreadConversationKey(threadSk, authorPk);
    const ck2 = getThreadConversationKey(threadSk, authorPk);

    expect(ck1).toEqual(ck2);
  });

  it('differs for different authors', () => {
    const threadSk = generateSecretKey();
    const pk1 = getPublicKey(generateSecretKey());
    const pk2 = getPublicKey(generateSecretKey());

    const ck1 = getThreadConversationKey(threadSk, pk1);
    const ck2 = getThreadConversationKey(threadSk, pk2);

    expect(ck1).not.toEqual(ck2);
  });
});

describe('looksLikeNip44', () => {
  it('rejects NIP-04 payloads', () => {
    expect(looksLikeNip44('base64ciphertext?iv=base64iv')).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(looksLikeNip44('')).toBe(false);
  });

  it('rejects short strings', () => {
    expect(looksLikeNip44('abc')).toBe(false);
  });

  it('rejects plaintext', () => {
    expect(looksLikeNip44('Hello, this is a normal message!')).toBe(false);
  });

  it('accepts a real NIP-44 payload', () => {
    const threadSk = generateSecretKey();
    const authorPk = getPublicKey(generateSecretKey());
    const ciphertext = encryptThreadContent('test', threadSk, authorPk);

    expect(looksLikeNip44(ciphertext)).toBe(true);
  });
});

describe('buildKeyWrapEvent', () => {
  it('produces a wrap that the recipient can unwrap to recover the thread key', () => {
    const threadSk = generateSecretKey();
    const threadPk = getPublicKey(threadSk);
    const granterSk = generateSecretKey();
    const granterPk = getPublicKey(granterSk);
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);

    const wrap = buildKeyWrapEvent(threadSk, granterSk, recipientPk);

    // Structure checks
    expect(wrap.kind).toBe(KEY_WRAP_KIND);
    expect(wrap.tags).toContainEqual(['d', threadPk]);
    expect(wrap.tags).toContainEqual(['p', recipientPk]);
    expect(wrap.created_at).toBeGreaterThan(0);

    // Round-trip: recipient decrypts and recovers the thread secret key
    const ck = nip44.v2.utils.getConversationKey(recipientSk, granterPk);
    const decryptedHex = nip44.v2.decrypt(wrap.content, ck);
    expect(decryptedHex).toBe(bytesToHex(threadSk));
  });

  it('a third party cannot unwrap the key', () => {
    const threadSk = generateSecretKey();
    const granterSk = generateSecretKey();
    const granterPk = getPublicKey(granterSk);
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const eveSk = generateSecretKey();

    const wrap = buildKeyWrapEvent(threadSk, granterSk, recipientPk);

    // Eve tries to decrypt with her own key against the granter
    const eveCk = nip44.v2.utils.getConversationKey(eveSk, granterPk);
    expect(() => nip44.v2.decrypt(wrap.content, eveCk)).toThrow();
  });

  it('two wraps for different recipients produce different ciphertext', () => {
    const threadSk = generateSecretKey();
    const granterSk = generateSecretKey();
    const recipient1Pk = getPublicKey(generateSecretKey());
    const recipient2Pk = getPublicKey(generateSecretKey());

    const wrap1 = buildKeyWrapEvent(threadSk, granterSk, recipient1Pk);
    const wrap2 = buildKeyWrapEvent(threadSk, granterSk, recipient2Pk);

    // Same thread key, different recipients, different ciphertexts
    expect(wrap1.content).not.toBe(wrap2.content);
    // But same d-tag (the thread pubkey)
    expect(wrap1.tags.find(t => t[0] === 'd')).toEqual(wrap2.tags.find(t => t[0] === 'd'));
  });
});
