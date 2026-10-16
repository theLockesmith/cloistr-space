import { create } from 'zustand';
import type { Contact, ContactEntry, ContactsCrdtState, ConflictResolution } from '@/types/contacts';

interface ContactsState {
  contacts: Map<string, Contact>;
  crdt: ContactsCrdtState;
  isLoading: boolean;
  isSyncing: boolean;
  lastError: string | null;
  conflictLog: ConflictResolution[];
  /**
   * The key this list belongs to. Contacts are per-identity, and publishing
   * one key's list under another corrupts it and publicly links the two.
   */
  owner: string | null;
  /** The key whose list was successfully read from a relay. Writes need it. */
  loadedFor: string | null;

  // Actions
  setContacts: (contacts: Map<string, Contact>) => void;
  addContact: (pubkey: string, relay?: string, petname?: string) => void;
  removeContact: (pubkey: string) => void;
  updateContact: (pubkey: string, updates: Partial<Contact>) => void;

  // CRDT operations
  mergeCrdt: (remoteState: ContactsCrdtState) => void;
  getPendingChanges: () => ContactEntry[];
  markSynced: () => void;
  /** Drop everything and start an empty, unread list for `owner`. */
  resetFor: (owner: string | null) => void;
  /** Record that `owner`'s list was read. */
  markLoaded: (owner: string) => void;

  setLoading: (loading: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setError: (error: string | null) => void;
}

/**
 * This device's id for `owner`, published in every kind:33000 it writes. One
 * per key, never shared: a single id across keys would appear in each key's
 * public list and link the identities that used this browser. With no owner
 * the id is throwaway, since nothing is published without one.
 */
const clientIdFor = (owner: string | null) => {
  if (!owner) return crypto.randomUUID();
  const storageKey = `cloistr-space-client-id:${owner}`;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(storageKey, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
};

export const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: new Map(),
  crdt: {
    entries: new Map(),
    version: 0,
    lastSync: 0,
    clientId: clientIdFor(null),
    pendingChanges: [],
  },
  isLoading: true,
  isSyncing: false,
  lastError: null,
  conflictLog: [],
  owner: null,
  loadedFor: null,

  setContacts: (contacts) => set({ contacts, isLoading: false }),

  addContact: (pubkey, relay, petname) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const entry: ContactEntry = {
      pubkey,
      relay,
      petname,
      timestamp,
      deleted: false,
    };

    set((state) => {
      const newEntries = new Map(state.crdt.entries);
      newEntries.set(pubkey, entry);

      const newContacts = new Map(state.contacts);
      newContacts.set(pubkey, {
        pubkey,
        relay,
        petname,
        timestamp,
        isFollowing: true,
        isFollowedBy: state.contacts.get(pubkey)?.isFollowedBy ?? false,
      });

      return {
        contacts: newContacts,
        crdt: {
          ...state.crdt,
          entries: newEntries,
          version: state.crdt.version + 1,
          pendingChanges: [...state.crdt.pendingChanges, entry],
        },
      };
    });
  },

  removeContact: (pubkey) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const entry: ContactEntry = {
      pubkey,
      timestamp,
      deleted: true,
    };

    set((state) => {
      const newEntries = new Map(state.crdt.entries);
      newEntries.set(pubkey, entry);

      const newContacts = new Map(state.contacts);
      const existing = newContacts.get(pubkey);
      if (existing) {
        newContacts.set(pubkey, { ...existing, isFollowing: false });
      }

      return {
        contacts: newContacts,
        crdt: {
          ...state.crdt,
          entries: newEntries,
          version: state.crdt.version + 1,
          pendingChanges: [...state.crdt.pendingChanges, entry],
        },
      };
    });
  },

  updateContact: (pubkey, updates) => {
    set((state) => {
      const newContacts = new Map(state.contacts);
      const existing = newContacts.get(pubkey);
      if (existing) {
        newContacts.set(pubkey, { ...existing, ...updates });
      }
      return { contacts: newContacts };
    });
  },

  mergeCrdt: (remoteState) => {
    set((state) => {
      const newEntries = new Map(state.crdt.entries);
      const newConflicts: ConflictResolution[] = [];

      for (const [pubkey, remoteEntry] of remoteState.entries) {
        const localEntry = newEntries.get(pubkey);

        if (!localEntry) {
          // No local entry, accept remote
          newEntries.set(pubkey, remoteEntry);
        } else if (remoteEntry.timestamp > localEntry.timestamp) {
          // Remote wins (LWW)
          newEntries.set(pubkey, remoteEntry);
          newConflicts.push({
            pubkey,
            localTimestamp: localEntry.timestamp,
            remoteTimestamp: remoteEntry.timestamp,
            winner: 'remote',
            resolvedAt: new Date(),
          });
        } else if (remoteEntry.timestamp < localEntry.timestamp) {
          // Local wins (LWW)
          newConflicts.push({
            pubkey,
            localTimestamp: localEntry.timestamp,
            remoteTimestamp: remoteEntry.timestamp,
            winner: 'local',
            resolvedAt: new Date(),
          });
        }
        // Equal timestamps: keep local (arbitrary but consistent)
      }

      // Rebuild contacts from merged entries
      const newContacts = new Map(state.contacts);
      for (const [pubkey, entry] of newEntries) {
        const existing = newContacts.get(pubkey);
        if (entry.deleted) {
          if (existing) {
            newContacts.set(pubkey, { ...existing, isFollowing: false });
          }
        } else {
          newContacts.set(pubkey, {
            ...(existing ?? { pubkey, isFollowing: true, isFollowedBy: false }),
            relay: entry.relay,
            petname: entry.petname,
            timestamp: entry.timestamp,
            isFollowing: true,
          });
        }
      }

      return {
        contacts: newContacts,
        crdt: {
          ...state.crdt,
          entries: newEntries,
          version: Math.max(state.crdt.version, remoteState.version) + 1,
          lastSync: Math.floor(Date.now() / 1000),
        },
        conflictLog: [...state.conflictLog, ...newConflicts],
      };
    });
  },

  getPendingChanges: () => get().crdt.pendingChanges,

  markSynced: () => {
    set((state) => ({
      crdt: {
        ...state.crdt,
        pendingChanges: [],
        lastSync: Math.floor(Date.now() / 1000),
      },
      isSyncing: false,
    }));
  },

  resetFor: (owner) => {
    set(() => ({
      contacts: new Map(),
      crdt: {
        entries: new Map(),
        version: 0,
        lastSync: 0,
        clientId: clientIdFor(owner),
        pendingChanges: [],
      },
      conflictLog: [],
      lastError: null,
      isLoading: true,
      // A sync still running for the previous key is not this key's sync.
      isSyncing: false,
      owner,
      loadedFor: null,
    }));
  },

  markLoaded: (owner) => {
    set((state) => (state.owner === owner ? { loadedFor: owner } : {}));
  },

  setLoading: (isLoading) => set({ isLoading }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setError: (lastError) => set({ lastError }),
}));
