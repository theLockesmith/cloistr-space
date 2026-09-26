import { describe, it, expect, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';

const STORAGE_PREFIX = 'cloistr:thread-keys:';

function makeEncryptor(identitySk: Uint8Array) {
  const identityPk = getPublicKey(identitySk);
  const ck = nip44.v2.utils.getConversationKey(identitySk, identityPk);
  return {
    encrypt: (plaintext: string) => nip44.v2.encrypt(plaintext, ck),
    decrypt: (ciphertext: string) => nip44.v2.decrypt(ciphertext, ck),
    pubkey: identityPk,
  };
}

describe('threadKeyPersistence', () => {
  let storage: Map<string, string>;
  let identitySk: Uint8Array;
  let enc: ReturnType<typeof makeEncryptor>;

  beforeEach(() => {
    storage = new Map();
    identitySk = generateSecretKey();
    enc = makeEncryptor(identitySk);
  });

  // We'll import the module after writing it. For now, describe the contract.

  it('saves an encrypted thread key to storage', async () => {
    const { saveThreadKey } = await import('./threadKeyPersistence');
    const threadSk = generateSecretKey();
    const threadPk = getPublicKey(threadSk);
    const threadHex = bytesToHex(threadSk);

    await saveThreadKey(
      threadPk,
      threadHex,
      enc.pubkey,
      async (_pk: string, plaintext: string) => enc.encrypt(plaintext),
      { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } },
    );

    const stored = storage.get(STORAGE_PREFIX + enc.pubkey);
    expect(stored).toBeTruthy();

    // The stored value must NOT contain the plaintext secret
    expect(stored).not.toContain(threadHex);

    // Decrypt the stored blob to verify it contains the key
    const parsed = JSON.parse(stored!);
    const entry = parsed[threadPk];
    expect(entry).toBeTruthy();
    const decrypted = enc.decrypt(entry);
    expect(decrypted).toBe(threadHex);
  });

  it('loads all persisted keys', async () => {
    const { saveThreadKey, loadThreadKeys } = await import('./threadKeyPersistence');
    const threadSk1 = generateSecretKey();
    const threadSk2 = generateSecretKey();
    const pk1 = getPublicKey(threadSk1);
    const pk2 = getPublicKey(threadSk2);
    const hex1 = bytesToHex(threadSk1);
    const hex2 = bytesToHex(threadSk2);

    const storageAdapter = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v); },
      removeItem: (k: string) => { storage.delete(k); },
    };
    const encryptFn = async (_pk: string, pt: string) => enc.encrypt(pt);
    const decryptFn = async (_pk: string, ct: string) => enc.decrypt(ct);

    await saveThreadKey(pk1, hex1, enc.pubkey, encryptFn, storageAdapter);
    await saveThreadKey(pk2, hex2, enc.pubkey, encryptFn, storageAdapter);

    const keys = await loadThreadKeys(enc.pubkey, decryptFn, storageAdapter);
    expect(keys).toHaveLength(2);
    expect(keys.find((k) => k.threadPubkey === pk1)?.secretHex).toBe(hex1);
    expect(keys.find((k) => k.threadPubkey === pk2)?.secretHex).toBe(hex2);
  });

  it('returns empty array when no keys are stored', async () => {
    const { loadThreadKeys } = await import('./threadKeyPersistence');
    const decryptFn = async (_pk: string, ct: string) => enc.decrypt(ct);
    const storageAdapter = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };

    const keys = await loadThreadKeys(enc.pubkey, decryptFn, storageAdapter);
    expect(keys).toEqual([]);
  });

  it('skips corrupted entries without failing', async () => {
    const { loadThreadKeys } = await import('./threadKeyPersistence');
    storage.set(STORAGE_PREFIX + enc.pubkey, JSON.stringify({
      'deadbeef': 'not-valid-nip44',
    }));
    const decryptFn = async (_pk: string, ct: string) => enc.decrypt(ct);
    const storageAdapter = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v); },
      removeItem: (k: string) => { storage.delete(k); },
    };

    const keys = await loadThreadKeys(enc.pubkey, decryptFn, storageAdapter);
    expect(keys).toEqual([]);
  });

  it('clearThreadKeys removes all stored keys for the user', async () => {
    const { saveThreadKey, clearThreadKeys } = await import('./threadKeyPersistence');
    const threadSk = generateSecretKey();
    const threadPk = getPublicKey(threadSk);
    const threadHex = bytesToHex(threadSk);
    const storageAdapter = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v); },
      removeItem: (k: string) => { storage.delete(k); },
    };
    const encryptFn = async (_pk: string, pt: string) => enc.encrypt(pt);

    await saveThreadKey(threadPk, threadHex, enc.pubkey, encryptFn, storageAdapter);
    expect(storage.has(STORAGE_PREFIX + enc.pubkey)).toBe(true);

    clearThreadKeys(enc.pubkey, storageAdapter);
    expect(storage.has(STORAGE_PREFIX + enc.pubkey)).toBe(false);
  });

  it('NEGATIVE: stored data for one user is unreadable by another', async () => {
    const { saveThreadKey, loadThreadKeys } = await import('./threadKeyPersistence');
    const threadSk = generateSecretKey();
    const threadPk = getPublicKey(threadSk);
    const threadHex = bytesToHex(threadSk);

    const storageAdapter = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v); },
      removeItem: (k: string) => { storage.delete(k); },
    };
    const encryptFn = async (_pk: string, pt: string) => enc.encrypt(pt);

    await saveThreadKey(threadPk, threadHex, enc.pubkey, encryptFn, storageAdapter);

    // A different user tries to load
    const otherSk = generateSecretKey();
    const otherPk = getPublicKey(otherSk);
    const otherCk = nip44.v2.utils.getConversationKey(otherSk, otherPk);
    const otherDecrypt = async (_pk: string, ct: string) => nip44.v2.decrypt(ct, otherCk);

    // They can't even find the storage key (different pubkey prefix)
    const keys = await loadThreadKeys(otherPk, otherDecrypt, storageAdapter);
    expect(keys).toEqual([]);
  });
});
