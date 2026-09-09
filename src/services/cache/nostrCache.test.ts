import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// We cannot use real IndexedDB in vitest's jsdom environment. Instead, test
// that the module degrades gracefully when IndexedDB is unavailable (which is
// the contract we promise: a missing cache is today's behaviour, not a crash).

describe('nostrCache (no IndexedDB)', () => {
  let originalIndexedDB: IDBFactory;

  beforeEach(() => {
    // jsdom does not provide indexedDB. If it somehow does in a future vitest
    // version, remove it for this suite.
    originalIndexedDB = globalThis.indexedDB;
    // @ts-expect-error -- deliberately removing indexedDB
    delete globalThis.indexedDB;
  });

  afterEach(() => {
    if (originalIndexedDB) {
      globalThis.indexedDB = originalIndexedDB;
    }
  });

  it('saveNotes returns false when IndexedDB is unavailable', async () => {
    const { saveNotes } = await import('./nostrCache');
    const result = await saveNotes([], 'following', 'somepubkey');
    expect(result).toBe(false);
  });

  it('loadNotes returns empty array when IndexedDB is unavailable', async () => {
    const { loadNotes } = await import('./nostrCache');
    const result = await loadNotes('following', 'somepubkey');
    expect(result).toEqual([]);
  });

  it('saveProfiles returns false when IndexedDB is unavailable', async () => {
    const { saveProfiles } = await import('./nostrCache');
    const result = await saveProfiles(new Map());
    expect(result).toBe(false);
  });

  it('loadProfiles returns empty map when IndexedDB is unavailable', async () => {
    const { loadProfiles } = await import('./nostrCache');
    const result = await loadProfiles();
    expect(result).toEqual(new Map());
  });

  it('saveContacts returns false when IndexedDB is unavailable', async () => {
    const { saveContacts } = await import('./nostrCache');
    const result = await saveContacts('somepubkey', ['a', 'b']);
    expect(result).toBe(false);
  });

  it('loadContacts returns null when IndexedDB is unavailable', async () => {
    const { loadContacts } = await import('./nostrCache');
    const result = await loadContacts('somepubkey');
    expect(result).toBeNull();
  });

  it('pruneStale returns 0 when IndexedDB is unavailable', async () => {
    const { pruneStale } = await import('./nostrCache');
    const result = await pruneStale();
    expect(result).toBe(0);
  });

  it('clearAll does not throw when IndexedDB is unavailable', async () => {
    const { clearAll } = await import('./nostrCache');
    await expect(clearAll()).resolves.toBeUndefined();
  });
});
