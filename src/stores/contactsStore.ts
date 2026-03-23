import { create } from 'zustand';
import type { Contact, ContactEntry, ContactsCrdtState, ConflictResolution } from '@/types/contacts';

interface ContactsState {
  contacts: Map<string, Contact>;
  crdt: ContactsCrdtState;
  isLoading: boolean;
  isSyncing: boolean;
  lastError: string | null;
  conflictLog: ConflictResolution[];

  // Actions
  setContacts: (contacts: Map<string, Contact>) => void;
  addContact: (pubkey: string, relay?: string, petname?: string) => void;
  removeContact: (pubkey: string) => void;
  updateContact: (pubkey: string, updates: Partial<Contact>) => void;

  // CRDT operations
  mergeCrdt: (remoteState: ContactsCrdtState) => void;
  getPendingChanges: () => ContactEntry[];
  markSynced: () => void;

  setLoading: (loading: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setError: (error: string | null) => void;
}

const generateClientId = () => {
  const stored = localStorage.getItem('cloistr-space-client-id');
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem('cloistr-space-client-id', id);
  return id;
};

export const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: new Map(),
  crdt: {
    entries: new Map(),
    version: 0,
    lastSync: 0,
    clientId: generateClientId(),
    pendingChanges: [],
  },
  isLoading: true,
  isSyncing: false,
  lastError: null,
  conflictLog: [],

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

  setLoading: (isLoading) => set({ isLoading }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setError: (lastError) => set({ lastError }),
}));
