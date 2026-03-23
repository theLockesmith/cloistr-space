/**
 * @fileoverview Contacts sync service
 * Synchronizes local contact list with relays using NIP-0A
 */

import { NDKEvent, type NdkService } from '@/services/nostr';
import { useContactsStore } from '@/stores/contactsStore';
import type { ContactsCrdtState } from '@/types/contacts';
import {
  NIP0A_KIND,
  parseNip0aEvent,
  buildNip0aTags,
  buildNip0aContent,
  mergeNip0aEvents,
  getNip0aFilter,
  parseKind3Event,
  getKind3Filter,
  countKind3Contacts,
} from './nip0a';

export interface SyncResult {
  success: boolean;
  remoteEventsFound: number;
  conflictsResolved: number;
  published: boolean;
  error?: string;
}

export interface ImportResult {
  success: boolean;
  contactsImported: number;
  contactsSkipped: number;
  published: boolean;
  error?: string;
}

/**
 * Contacts sync service for NIP-0A synchronization
 */
export class ContactsSyncService {
  private ndkService: NdkService;
  private syncInProgress = false;

  constructor(ndkService: NdkService) {
    this.ndkService = ndkService;
  }

  /**
   * Perform a full sync: fetch remote, merge, publish changes
   */
  async sync(pubkey: string): Promise<SyncResult> {
    if (this.syncInProgress) {
      return {
        success: false,
        remoteEventsFound: 0,
        conflictsResolved: 0,
        published: false,
        error: 'Sync already in progress',
      };
    }

    this.syncInProgress = true;
    const store = useContactsStore.getState();
    store.setSyncing(true);
    store.setError(null);

    try {
      // Step 1: Fetch remote events
      const remoteEvents = await this.fetchRemoteContacts(pubkey);

      // Step 2: Merge remote state with local
      let conflictsResolved = 0;
      if (remoteEvents.length > 0) {
        const mergedRemote = mergeNip0aEvents(remoteEvents);
        const beforeConflicts = store.conflictLog.length;
        store.mergeCrdt(mergedRemote);
        conflictsResolved = useContactsStore.getState().conflictLog.length - beforeConflicts;
      }

      // Step 3: Publish local changes if any
      const pendingChanges = store.getPendingChanges();
      let published = false;

      if (pendingChanges.length > 0 || remoteEvents.length === 0) {
        // Publish full state to ensure consistency
        published = await this.publishContacts();
        if (published) {
          useContactsStore.getState().markSynced();
        }
      } else {
        // No local changes, just mark as synced
        useContactsStore.getState().markSynced();
      }

      return {
        success: true,
        remoteEventsFound: remoteEvents.length,
        conflictsResolved,
        published,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      store.setError(message);
      return {
        success: false,
        remoteEventsFound: 0,
        conflictsResolved: 0,
        published: false,
        error: message,
      };
    } finally {
      this.syncInProgress = false;
      useContactsStore.getState().setSyncing(false);
    }
  }

  /**
   * Fetch contact list events from relays
   */
  async fetchRemoteContacts(pubkey: string): Promise<NDKEvent[]> {
    const filter = getNip0aFilter(pubkey);
    const events = await this.ndkService.fetchEvents(filter);
    return Array.from(events);
  }

  /**
   * Publish current contact list to relays
   */
  async publishContacts(): Promise<boolean> {
    const store = useContactsStore.getState();
    const ndk = this.ndkService.getNdk();

    if (!ndk.signer) {
      throw new Error('Signer not available - cannot publish');
    }

    // Create the NIP-0A event
    const event = new NDKEvent(ndk);
    event.kind = NIP0A_KIND;
    event.content = buildNip0aContent(store.crdt);
    event.tags = buildNip0aTags(store.crdt);

    try {
      // Sign and publish
      await event.sign();
      const relays = await event.publish();

      if (relays.size === 0) {
        throw new Error('Event not published to any relay');
      }

      console.log(`[ContactsSync] Published to ${relays.size} relays`);
      return true;
    } catch (error) {
      console.error('[ContactsSync] Publish failed:', error);
      throw error;
    }
  }

  /**
   * Subscribe to real-time contact list updates
   * Returns cleanup function
   */
  subscribeToUpdates(pubkey: string, onUpdate: (state: ContactsCrdtState) => void): () => void {
    const filter = getNip0aFilter(pubkey);
    const sub = this.ndkService.subscribe(filter, { closeOnEose: false });

    sub.on('event', (event: NDKEvent) => {
      // Only process events from the user (not our own publishes)
      if (event.pubkey !== pubkey) {
        return;
      }

      const remoteState = parseNip0aEvent(event);
      onUpdate(remoteState);
    });

    sub.start();

    return () => {
      sub.stop();
    };
  }

  /**
   * Check if sync is in progress
   */
  isSyncing(): boolean {
    return this.syncInProgress;
  }

  // ===========================================================================
  // Kind:3 Legacy Import
  // ===========================================================================

  /**
   * Check if user has a kind:3 contact list to import
   * Returns the count of contacts, or 0 if none found
   */
  async checkKind3Available(pubkey: string): Promise<{ available: boolean; count: number }> {
    const filter = getKind3Filter(pubkey);
    const events = await this.ndkService.fetchEvents(filter);
    const eventArray = Array.from(events);

    if (eventArray.length === 0) {
      return { available: false, count: 0 };
    }

    // Get the most recent event
    const latestEvent = eventArray.reduce((latest, event) =>
      (event.created_at ?? 0) > (latest.created_at ?? 0) ? event : latest
    );

    const count = countKind3Contacts(latestEvent);
    return { available: count > 0, count };
  }

  /**
   * Import contacts from kind:3 (NIP-02) legacy format
   * Merges with existing contacts using LWW semantics
   */
  async importFromKind3(pubkey: string): Promise<ImportResult> {
    if (this.syncInProgress) {
      return {
        success: false,
        contactsImported: 0,
        contactsSkipped: 0,
        published: false,
        error: 'Sync in progress - try again later',
      };
    }

    this.syncInProgress = true;
    const store = useContactsStore.getState();
    store.setSyncing(true);
    store.setError(null);

    try {
      // Fetch kind:3 event
      const filter = getKind3Filter(pubkey);
      const events = await this.ndkService.fetchEvents(filter);
      const eventArray = Array.from(events);

      if (eventArray.length === 0) {
        return {
          success: false,
          contactsImported: 0,
          contactsSkipped: 0,
          published: false,
          error: 'No kind:3 contact list found',
        };
      }

      // Get the most recent event
      const latestEvent = eventArray.reduce((latest, event) =>
        (event.created_at ?? 0) > (latest.created_at ?? 0) ? event : latest
      );

      // Parse kind:3 into CRDT state
      const importedState = parseKind3Event(latestEvent);

      // Count how many are new vs existing
      const currentState = store.crdt;
      let imported = 0;
      let skipped = 0;

      for (const [pubkeyEntry, entry] of importedState.entries) {
        const existing = currentState.entries.get(pubkeyEntry);
        if (!existing) {
          imported++;
        } else if (entry.timestamp > existing.timestamp) {
          imported++;
        } else {
          skipped++;
        }
      }

      // Merge into local state
      store.mergeCrdt(importedState);

      // Publish the merged state as NIP-0A
      const published = await this.publishContacts();
      if (published) {
        useContactsStore.getState().markSynced();
      }

      console.log(`[ContactsSync] Imported ${imported} contacts from kind:3 (${skipped} skipped)`);

      return {
        success: true,
        contactsImported: imported,
        contactsSkipped: skipped,
        published,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed';
      store.setError(message);
      return {
        success: false,
        contactsImported: 0,
        contactsSkipped: 0,
        published: false,
        error: message,
      };
    } finally {
      this.syncInProgress = false;
      useContactsStore.getState().setSyncing(false);
    }
  }
}
