/**
 * @fileoverview React hook for contacts synchronization
 * Provides easy-to-use sync functionality for components
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuth } from '@/components/auth/AuthProvider';
import { useContactsStore } from '@/stores/contactsStore';
import { ContactsSyncService, type SyncResult, type ImportResult } from './contactsSync';

interface UseContactsSyncOptions {
  /** Auto-sync on mount and when connection established */
  autoSync?: boolean;
  /** Subscribe to real-time updates */
  subscribeToUpdates?: boolean;
  /** Sync interval in ms (0 = no auto-refresh) */
  syncInterval?: number;
}

interface Kind3Status {
  available: boolean;
  count: number;
  checked: boolean;
}

interface UseContactsSyncReturn {
  /** Trigger a manual sync */
  sync: () => Promise<SyncResult>;
  /** Whether sync is in progress */
  isSyncing: boolean;
  /** Last sync error */
  lastError: string | null;
  /** Last sync result */
  lastSyncResult: SyncResult | null;
  /** Whether service is ready (connected + authenticated) */
  isReady: boolean;
  /** Kind:3 import status */
  kind3Status: Kind3Status;
  /** Check if kind:3 contacts are available */
  checkKind3: () => Promise<void>;
  /** Import contacts from kind:3 */
  importFromKind3: () => Promise<ImportResult>;
}

/**
 * Hook for syncing contacts with NIP-0A
 */
export function useContactsSync(options: UseContactsSyncOptions = {}): UseContactsSyncReturn {
  const {
    autoSync = true,
    subscribeToUpdates = true,
    syncInterval = 0,
  } = options;

  const { service, isConnected } = useNdk();
  const { pubkey, isAuthenticated } = useAuth();
  const { isSyncing, lastError, mergeCrdt } = useContactsStore();

  const syncServiceRef = useRef<ContactsSyncService | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [kind3Status, setKind3Status] = useState<Kind3Status>({
    available: false,
    count: 0,
    checked: false,
  });

  const isReady = Boolean(service && isConnected && isAuthenticated && pubkey);

  // Initialize sync service when NDK service is available
  useEffect(() => {
    if (service && !syncServiceRef.current) {
      syncServiceRef.current = new ContactsSyncService(service);
    }
  }, [service]);

  // Manual sync function
  const sync = useCallback(async (): Promise<SyncResult> => {
    if (!syncServiceRef.current || !pubkey) {
      const result: SyncResult = {
        success: false,
        remoteEventsFound: 0,
        conflictsResolved: 0,
        published: false,
        error: 'Sync service not ready',
      };
      setLastSyncResult(result);
      return result;
    }

    const result = await syncServiceRef.current.sync(pubkey);
    setLastSyncResult(result);
    return result;
  }, [pubkey]);

  // Auto-sync on connection
  // This is intentional - we want to trigger sync when connection is established
  useEffect(() => {
    if (autoSync && isReady && syncServiceRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      sync();
    }
  }, [autoSync, isReady, sync]);

  // Sync interval
  useEffect(() => {
    if (syncInterval <= 0 || !isReady) {
      return;
    }

    const intervalId = setInterval(() => {
      sync();
    }, syncInterval);

    return () => clearInterval(intervalId);
  }, [syncInterval, isReady, sync]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!subscribeToUpdates || !isReady || !syncServiceRef.current || !pubkey) {
      return;
    }

    const unsubscribe = syncServiceRef.current.subscribeToUpdates(pubkey, (remoteState) => {
      // Merge incoming remote state
      mergeCrdt(remoteState);
    });

    return unsubscribe;
  }, [subscribeToUpdates, isReady, pubkey, mergeCrdt]);

  // Check for kind:3 contacts on ready
  const checkKind3 = useCallback(async (): Promise<void> => {
    if (!syncServiceRef.current || !pubkey) {
      return;
    }

    const result = await syncServiceRef.current.checkKind3Available(pubkey);
    setKind3Status({
      available: result.available,
      count: result.count,
      checked: true,
    });
  }, [pubkey]);

  // Auto-check kind:3 on ready
  useEffect(() => {
    if (isReady && !kind3Status.checked && syncServiceRef.current) {
      checkKind3();
    }
  }, [isReady, kind3Status.checked, checkKind3]);

  // Import from kind:3
  const importFromKind3 = useCallback(async (): Promise<ImportResult> => {
    if (!syncServiceRef.current || !pubkey) {
      return {
        success: false,
        contactsImported: 0,
        contactsSkipped: 0,
        published: false,
        error: 'Sync service not ready',
      };
    }

    const result = await syncServiceRef.current.importFromKind3(pubkey);

    // Re-check kind:3 status after import
    if (result.success) {
      setKind3Status((prev) => ({
        ...prev,
        available: false, // Already imported
      }));
    }

    return result;
  }, [pubkey]);

  return {
    sync,
    isSyncing,
    lastError,
    lastSyncResult,
    isReady,
    kind3Status,
    checkKind3,
    importFromKind3,
  };
}
