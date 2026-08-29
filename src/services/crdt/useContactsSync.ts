/**
 * @fileoverview React hook for contacts synchronization
 * Provides easy-to-use sync functionality for components
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuth } from '@/components/auth/AuthProvider';
import { useContactsStore } from '@/stores/contactsStore';
import { ContactsSyncService, type SyncResult, type ImportResult } from './contactsSync';
import type { RecoveryCandidate } from './recovery';

interface UseContactsSyncOptions {
  /** Auto-sync on mount and when connection established */
  autoSync?: boolean;
  /** Subscribe to real-time updates */
  subscribeToUpdates?: boolean;
  /** Sync interval in ms (0 = no auto-refresh) */
  syncInterval?: number;
  /**
   * Import a kind:3 list automatically when the user has no NIP-0A list yet.
   *
   * Only fires on the narrow case described in autoImportState below. Off means
   * kind:3 is import-on-request only, which is how this behaved before.
   */
  autoImportKind3?: boolean;
}

/**
 * Whether a kind:3 auto-import is safe right now.
 *
 * The distinction that matters is between "this user genuinely has no NIP-0A
 * contact list" and "we have not managed to read their NIP-0A list yet". Those
 * both leave the local store empty, and importing in the second case is
 * destructive:
 *
 * importFromKind3 does not just populate locally -- it merges under LWW and
 * then PUBLISHES a new kind:33000. NIP-0A records unfollows as tombstones
 * (["np", pubkey, timestamp], nip0a.ts). So if the real list has not loaded and
 * we import a kind:3 that another client updated more recently than a
 * tombstone, LWW resurrects a contact the user deliberately unfollowed, and
 * republishes it under their own key. Silent, and hard to attribute afterwards.
 *
 * Hence three states rather than "is the store empty".
 */
export type AutoImportState =
  /** Sync completed and the user already has a NIP-0A list. Never import. */
  | 'synced-populated'
  /** Sync completed and there is genuinely nothing. The only safe case. */
  | 'synced-empty'
  /** No successful sync yet. Do nothing and wait -- absence proves nothing. */
  | 'not-synced';

export function autoImportState(result: SyncResult | null, isReady: boolean): AutoImportState {
  // isReady includes isConnected. Without it a failure to reach any relay is
  // indistinguishable from a relay answering with nothing, since NDK's
  // fetchEvents resolves empty either way. This narrows that gap; it does not
  // close it. A user whose list lives solely on a relay that is down while
  // another is up can still look 'synced-empty'. Closing it properly needs
  // per-relay EOSE accounting that NDK does not surface here.
  if (!isReady || !result || !result.success) {
    return 'not-synced';
  }
  // Entries, not events. An existing but CONTENTLESS kind:33000 is not
  // meaningfully different from having none, and it is precisely the state
  // Space used to manufacture for itself by publishing an empty list on first
  // sync -- which then blocked import forever, because the gate saw an event.
  //
  // Safe to treat as importable because a deliberate "I follow nobody" is never
  // contentless: NIP-0A records unfollows as np tombstones, so unfollowing
  // everyone leaves an entry per removed contact. Zero entries means nothing was
  // ever said, not that someone said no.
  return result.remoteEntriesFound > 0 ? 'synced-populated' : 'synced-empty';
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
  /** Whether a kind:3 auto-import is currently safe, and why. */
  autoImportState: AutoImportState;
  /**
   * A contact list Space overwrote with an empty one, if there is one.
   *
   * Null means nothing to recover. Deliberately NOT applied automatically:
   * restoring someone's contact list is a visible act and they should be told
   * what came back and from when.
   */
  recovery: RecoveryCandidate | null;
  /** Restore the recovered list and republish it. */
  applyRecovery: () => Promise<boolean>;
}

/**
 * Hook for syncing contacts with NIP-0A
 */
export function useContactsSync(options: UseContactsSyncOptions = {}): UseContactsSyncReturn {
  const {
    autoSync = true,
    subscribeToUpdates = true,
    syncInterval = 0,
    autoImportKind3 = true,
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
        remoteEntriesFound: 0,
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

  const importState = autoImportState(lastSyncResult, isReady);

  // Look for an overwritten contact list once the store is known to be empty.
  // Checked at the same gate as auto-import because it is the same evidence:
  // a confirmed-empty current list is what makes an older one worth restoring.
  const [recovery, setRecovery] = useState<RecoveryCandidate | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const recoveryCheckedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (importState !== 'synced-empty' || !pubkey || !syncServiceRef.current) return;
    if (recoveryCheckedForRef.current === pubkey) return;

    recoveryCheckedForRef.current = pubkey;
    const service = syncServiceRef.current;

    const timeoutId = setTimeout(() => {
      service
        .findRecovery(pubkey)
        .then((found) => {
          setRecovery(found);
          setRecoveryChecked(true);
        })
        .catch(() => {
          // Do not block auto-import forever on a failed lookup.
          setRecoveryChecked(true);
          // Recovery is a bonus path. Failing to find one must not disturb
          // normal sync, and leaves auto-import as the fallback.
          recoveryCheckedForRef.current = null;
        });
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [importState, pubkey]);

  const applyRecovery = useCallback(async (): Promise<boolean> => {
    if (!syncServiceRef.current || !recovery) return false;
    const ok = await syncServiceRef.current.applyRecovery(recovery);
    if (ok) setRecovery(null);
    return ok;
  }, [recovery]);

  // Auto-import a kind:3 list for a user who has no NIP-0A list.
  //
  // Before this, arriving with a full follow list in kind:3 -- which is what
  // every other Nostr client writes -- produced an empty following feed and a
  // prompt on another page. Space could read the user's kind:0 profile fine and
  // then claimed not to know who they followed, which reads as broken no matter
  // how the empty state is worded.
  //
  // Gated on 'synced-empty' specifically, never on "the store looks empty". See
  // AutoImportState for why that distinction is load-bearing rather than
  // pedantic.
  const autoImportedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!autoImportKind3) return;
    if (importState !== 'synced-empty') return;
    // Recovery outranks import and must be allowed to resolve first. An older
    // kind:33000 restores what the user actually had HERE, including NIP-0A
    // state that never existed in kind:3. Importing first would publish a
    // non-empty list, which hides the recovery candidate behind the same
    // synced-populated gate that caused this whole problem.
    if (!recoveryChecked || recovery) return;
    // Nothing to import, or we have not looked yet.
    if (!kind3Status.checked || !kind3Status.available) return;
    if (!pubkey) return;
    // Once per identity. Keyed by pubkey rather than a boolean so switching
    // accounts re-evaluates for the new key instead of inheriting the old
    // decision -- contact lists are per-identity.
    if (autoImportedForRef.current === pubkey) return;

    autoImportedForRef.current = pubkey;
    // The rule fires because importFromKind3 eventually calls setKind3Status.
    // That happens in a promise continuation after a relay round trip, not
    // synchronously during this effect, so it does not cause the re-render
    // cascade the rule guards against. Same shape as the autoSync effect above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void importFromKind3();
  }, [
    autoImportKind3,
    importState,
    kind3Status.checked,
    kind3Status.available,
    pubkey,
    importFromKind3,
    recoveryChecked,
    recovery,
  ]);

  return {
    sync,
    isSyncing,
    lastError,
    lastSyncResult,
    isReady,
    kind3Status,
    checkKind3,
    importFromKind3,
    autoImportState: importState,
    recovery,
    applyRecovery,
  };
}
