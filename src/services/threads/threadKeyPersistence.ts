/**
 * At-rest encryption for thread secret keys.
 *
 * Thread keys are NIP-44 encrypted to the user's OWN pubkey before
 * persisting. The plaintext never touches browser storage.
 *
 * Through NIP-46: nip44_encrypt(own_pubkey, secret) to store,
 * nip44_decrypt(own_pubkey, blob) to load. Both are already-granted
 * signer methods.
 */

const STORAGE_PREFIX = 'cloistr:thread-keys:';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type EncryptFn = (recipientPubkey: string, plaintext: string) => Promise<string>;
export type DecryptFn = (senderPubkey: string, ciphertext: string) => Promise<string>;

export interface PersistedKey {
  threadPubkey: string;
  secretHex: string;
}

function storageKey(ownerPubkey: string): string {
  return STORAGE_PREFIX + ownerPubkey;
}

function readStore(ownerPubkey: string, storage: StorageAdapter): Record<string, string> {
  try {
    const raw = storage.getItem(storageKey(ownerPubkey));
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStore(ownerPubkey: string, data: Record<string, string>, storage: StorageAdapter): void {
  try {
    storage.setItem(storageKey(ownerPubkey), JSON.stringify(data));
  } catch {
    // Storage full or blocked — keys remain in memory only
  }
}

export async function saveThreadKey(
  threadPubkey: string,
  secretHex: string,
  ownerPubkey: string,
  encrypt: EncryptFn,
  storage: StorageAdapter,
): Promise<void> {
  const encrypted = await encrypt(ownerPubkey, secretHex);
  const store = readStore(ownerPubkey, storage);
  store[threadPubkey] = encrypted;
  writeStore(ownerPubkey, store, storage);
}

export async function loadThreadKeys(
  ownerPubkey: string,
  decrypt: DecryptFn,
  storage: StorageAdapter,
): Promise<PersistedKey[]> {
  const store = readStore(ownerPubkey, storage);
  const entries = Object.entries(store);
  if (entries.length === 0) return [];

  const results: PersistedKey[] = [];
  for (const [threadPubkey, encrypted] of entries) {
    try {
      const secretHex = await decrypt(ownerPubkey, encrypted);
      if (secretHex && /^[0-9a-f]{64}$/i.test(secretHex)) {
        results.push({ threadPubkey, secretHex });
      }
    } catch {
      // Corrupted or wrong key — skip
    }
  }
  return results;
}

export function clearThreadKeys(
  ownerPubkey: string,
  storage: StorageAdapter,
): void {
  try {
    storage.removeItem(storageKey(ownerPubkey));
  } catch {
    // Storage unavailable
  }
}
