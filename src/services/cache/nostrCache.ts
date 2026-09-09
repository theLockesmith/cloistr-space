/**
 * @fileoverview Local IndexedDB cache for Nostr data.
 *
 * The design document (architecture/caching-service.md) says:
 *
 *   "Before any server work: local persistence. A returning user should render
 *   instantly from IndexedDB and refresh in the background."
 *
 * This is that. It is NOT an NDK cache adapter. The existing adapters
 * (ndk-cache-dexie, ndk-cache-sqlite-wasm) each bundle their own copy of NDK,
 * creating an instanceof boundary. This module stores our own projections
 * (Note, AuthorProfile) at the application layer, where they are already
 * shaped for rendering.
 *
 * What it caches:
 *   - Feed notes (kind:1) per mode/pubkey, capped at 100
 *   - Author profiles (kind:0) by pubkey
 *   - Contact list snapshot for instant filter construction
 *
 * What it deliberately does NOT do:
 *   - Feed NDK. NDK still hits relays for the authoritative answer.
 *   - Store DMs, gift-wrapped content, or private group content.
 *   - Log which pubkey asked for what. See the privacy design.
 */

import type { Note } from '@/types/social';
import type { AuthorProfile } from '@/services/profile/useAuthorProfiles';

const DB_NAME = 'cloistr-space-cache';
const DB_VERSION = 1;

// Store names
const NOTES_STORE = 'notes';
const PROFILES_STORE = 'profiles';
const CONTACTS_STORE = 'contacts';
const META_STORE = 'meta';

/** Max notes per feed key. Two screens of content, enough to look instant. */
const MAX_NOTES_PER_FEED = 100;
/** Notes older than 7 days are pruned on write. */
const NOTE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedNote {
  /** Composite key: `${mode}:${pubkey}:${note.id}` */
  key: string;
  feedKey: string;
  note: Note;
  cachedAt: number;
}

export interface CachedProfile {
  pubkey: string;
  profile: AuthorProfile;
  cachedAt: number;
}

export interface CachedContacts {
  /** The owning pubkey. */
  pubkey: string;
  /** Followed pubkeys. Just the list, not the full CRDT state. */
  following: string[];
  cachedAt: number;
}

/**
 * Open (or create) the cache database.
 *
 * Returns null rather than throwing when IndexedDB is unavailable. The caller
 * falls back to relay-only loading, which is today's behaviour and not a
 * regression. Same pattern as feedSnapshot.ts: a missing cache degrades to
 * what we already had.
 */
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        // Notes: keyed by composite `feedKey:noteId`, indexed by feedKey for
        // batch reads and by cachedAt for age-based pruning.
        if (!db.objectStoreNames.contains(NOTES_STORE)) {
          const store = db.createObjectStore(NOTES_STORE, { keyPath: 'key' });
          store.createIndex('byFeed', 'feedKey', { unique: false });
          store.createIndex('byCachedAt', 'cachedAt', { unique: false });
        }

        // Profiles: keyed by pubkey.
        if (!db.objectStoreNames.contains(PROFILES_STORE)) {
          db.createObjectStore(PROFILES_STORE, { keyPath: 'pubkey' });
        }

        // Contacts: one row per owning pubkey.
        if (!db.objectStoreNames.contains(CONTACTS_STORE)) {
          db.createObjectStore(CONTACTS_STORE, { keyPath: 'pubkey' });
        }

        // Meta: key-value for bookkeeping (last prune timestamp, etc).
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);

      request.onerror = () => {
        console.warn('[cache] IndexedDB open failed:', request.error);
        resolve(null);
      };

      // Blocked means another tab has an older version open. Don't wait.
      request.onblocked = () => {
        console.warn('[cache] IndexedDB blocked by another tab');
        resolve(null);
      };
    } catch {
      // IndexedDB not available at all (private browsing, disabled, etc).
      resolve(null);
    }
  });
}

/** Reusable IDB transaction helper. */
function txn(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode
): IDBTransaction {
  return db.transaction(stores, mode);
}

/** Promisify an IDBRequest. */
function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---- Notes ----

function feedKey(mode: string, pubkey: string | null | undefined): string {
  return `${mode}:${pubkey ?? 'anon'}`;
}

function noteKey(fk: string, noteId: string): string {
  return `${fk}:${noteId}`;
}

export async function saveNotes(
  notes: Note[],
  mode: string,
  pubkey: string | null | undefined
): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;

  try {
    const fk = feedKey(mode, pubkey);
    const now = Date.now();
    const slice = notes.slice(0, MAX_NOTES_PER_FEED);

    const t = txn(db, NOTES_STORE, 'readwrite');
    const store = t.objectStore(NOTES_STORE);

    // Clear old entries for this feed before writing new ones.
    const index = store.index('byFeed');
    const range = IDBKeyRange.only(fk);
    const cursor = index.openCursor(range);

    await new Promise<void>((resolve, reject) => {
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          c.delete();
          c.continue();
        } else {
          resolve();
        }
      };
      cursor.onerror = () => reject(cursor.error);
    });

    // Write the current set.
    for (const note of slice) {
      const entry: CachedNote = {
        key: noteKey(fk, note.id),
        feedKey: fk,
        note,
        cachedAt: now,
      };
      store.put(entry);
    }

    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });

    return true;
  } catch (err) {
    console.warn('[cache] saveNotes failed:', err);
    return false;
  } finally {
    db.close();
  }
}

export async function loadNotes(
  mode: string,
  pubkey: string | null | undefined
): Promise<Note[]> {
  const db = await openDb();
  if (!db) return [];

  try {
    const fk = feedKey(mode, pubkey);
    const t = txn(db, NOTES_STORE, 'readonly');
    const store = t.objectStore(NOTES_STORE);
    const index = store.index('byFeed');
    const entries = await req(index.getAll(IDBKeyRange.only(fk)));

    const now = Date.now();
    return (entries as CachedNote[])
      .filter((e) => now - e.cachedAt < NOTE_MAX_AGE_MS)
      .map((e) => e.note)
      .sort((a, b) => {
        const ta = a.repostBy?.boostedAt ?? a.createdAt;
        const tb = b.repostBy?.boostedAt ?? b.createdAt;
        return tb - ta;
      })
      .slice(0, MAX_NOTES_PER_FEED);
  } catch (err) {
    console.warn('[cache] loadNotes failed:', err);
    return [];
  } finally {
    db.close();
  }
}

// ---- Profiles ----

export async function saveProfiles(
  profiles: Map<string, AuthorProfile>
): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;

  try {
    const t = txn(db, PROFILES_STORE, 'readwrite');
    const store = t.objectStore(PROFILES_STORE);
    const now = Date.now();

    for (const [pubkey, profile] of profiles) {
      const entry: CachedProfile = { pubkey, profile, cachedAt: now };
      store.put(entry);
    }

    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });

    return true;
  } catch (err) {
    console.warn('[cache] saveProfiles failed:', err);
    return false;
  } finally {
    db.close();
  }
}

export async function loadProfiles(): Promise<Map<string, AuthorProfile>> {
  const db = await openDb();
  if (!db) return new Map();

  try {
    const t = txn(db, PROFILES_STORE, 'readonly');
    const store = t.objectStore(PROFILES_STORE);
    const entries = await req(store.getAll()) as CachedProfile[];

    const result = new Map<string, AuthorProfile>();
    // Return even stale profiles. The caller re-fetches from relays anyway;
    // showing a 48h-old avatar beats showing a truncated pubkey.
    for (const entry of entries) {
      result.set(entry.pubkey, entry.profile);
    }
    return result;
  } catch (err) {
    console.warn('[cache] loadProfiles failed:', err);
    return new Map();
  } finally {
    db.close();
  }
}

/**
 * Load profiles for a specific set of pubkeys only.
 *
 * Used when the feed restores from cache and knows exactly which authors
 * it needs. Cheaper than loading the whole table when thousands of
 * profiles have accumulated.
 */
export async function loadProfilesFor(
  pubkeys: string[]
): Promise<Map<string, AuthorProfile>> {
  const db = await openDb();
  if (!db) return new Map();

  try {
    const t = txn(db, PROFILES_STORE, 'readonly');
    const store = t.objectStore(PROFILES_STORE);
    const result = new Map<string, AuthorProfile>();

    for (const pk of pubkeys) {
      const entry = await req(store.get(pk)) as CachedProfile | undefined;
      if (entry) {
        result.set(pk, entry.profile);
      }
    }

    return result;
  } catch (err) {
    console.warn('[cache] loadProfilesFor failed:', err);
    return new Map();
  } finally {
    db.close();
  }
}

// ---- Contacts ----

export async function saveContacts(
  pubkey: string,
  following: string[]
): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;

  try {
    const t = txn(db, CONTACTS_STORE, 'readwrite');
    const store = t.objectStore(CONTACTS_STORE);
    const entry: CachedContacts = {
      pubkey,
      following,
      cachedAt: Date.now(),
    };
    store.put(entry);

    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });

    return true;
  } catch (err) {
    console.warn('[cache] saveContacts failed:', err);
    return false;
  } finally {
    db.close();
  }
}

export async function loadContacts(
  pubkey: string
): Promise<string[] | null> {
  const db = await openDb();
  if (!db) return null;

  try {
    const t = txn(db, CONTACTS_STORE, 'readonly');
    const store = t.objectStore(CONTACTS_STORE);
    const entry = await req(store.get(pubkey)) as CachedContacts | undefined;
    return entry?.following ?? null;
  } catch (err) {
    console.warn('[cache] loadContacts failed:', err);
    return null;
  } finally {
    db.close();
  }
}

// ---- Maintenance ----

/**
 * Prune entries older than their TTL. Called periodically, not on every read.
 *
 * Returns the count of entries removed.
 */
export async function pruneStale(): Promise<number> {
  const db = await openDb();
  if (!db) return 0;

  let removed = 0;
  try {
    const now = Date.now();

    // Prune old notes.
    const t = txn(db, NOTES_STORE, 'readwrite');
    const store = t.objectStore(NOTES_STORE);
    const index = store.index('byCachedAt');
    const cutoff = now - NOTE_MAX_AGE_MS;
    const range = IDBKeyRange.upperBound(cutoff);
    const cursor = index.openCursor(range);

    await new Promise<void>((resolve, reject) => {
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          c.delete();
          removed++;
          c.continue();
        } else {
          resolve();
        }
      };
      cursor.onerror = () => reject(cursor.error);
    });

    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } catch (err) {
    console.warn('[cache] pruneStale failed:', err);
  } finally {
    db.close();
  }

  return removed;
}

/**
 * Drop the entire cache. For sign-out or debugging.
 */
export async function clearAll(): Promise<void> {
  try {
    const dbs = await indexedDB.databases?.();
    if (dbs?.some((d) => d.name === DB_NAME)) {
      indexedDB.deleteDatabase(DB_NAME);
    }
  } catch {
    // Not available or not permitted. The cache ages out on its own.
  }
}
