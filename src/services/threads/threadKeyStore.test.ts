import { describe, it, expect, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, utils as ntUtils } from 'nostr-tools';

const { bytesToHex } = ntUtils;
import {
  ThreadKeyStore,
  decryptThreadContent,
  encryptThreadContent,
  getThreadConversationKey,
  looksLikeNip44,
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
