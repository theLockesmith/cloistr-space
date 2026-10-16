/**
 * @fileoverview Recent files hook using NDK subscriptions
 * Subscribes to kind:1063 (NIP-94 file metadata) events
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { useNdk, useHeadlessAdapters, subscribeStream, type NDKEvent } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { listDriveFiles, listBlossomFiles, mergeFiles } from './fileSources';
import { trackAnswers, useUnreachable, withReachability, NO_RELAY_ANSWERED } from './widgetReads';
import type { FileMetadata, WidgetState } from '@/types/activity';

/** NIP-94 File Metadata kind */
const FILE_METADATA_KIND = 1063;

/** Maximum files to display */
const MAX_FILES = 10;

/** Parse a kind:1063 event into FileMetadata */
function parseFileEvent(event: NDKEvent): FileMetadata | null {
  const tags = event.tags;

  // Required: url tag
  const urlTag = tags.find((t) => t[0] === 'url');
  if (!urlTag?.[1]) return null;

  // Get filename from tag or infer from URL
  const nameTag = tags.find((t) => t[0] === 'name');
  const url = urlTag[1];
  const name = nameTag?.[1] || url.split('/').pop() || 'Unnamed file';

  // MIME type
  const mimeTag = tags.find((t) => t[0] === 'm' || t[0] === 'mime');
  const mimeType = mimeTag?.[1] || 'application/octet-stream';

  // Size
  const sizeTag = tags.find((t) => t[0] === 'size');
  const size = sizeTag?.[1] ? parseInt(sizeTag[1], 10) : undefined;

  // Hash
  const hashTag = tags.find((t) => t[0] === 'x');
  const hash = hashTag?.[1];

  // Thumbnail
  const thumbTag = tags.find((t) => t[0] === 'thumb');
  const thumbnail = thumbTag?.[1];

  // Dimensions
  const dimTag = tags.find((t) => t[0] === 'dim');
  let dimensions: FileMetadata['dimensions'];
  if (dimTag?.[1]) {
    const [w, h] = dimTag[1].split('x').map(Number);
    if (w && h) dimensions = { width: w, height: h };
  }

  // Blurhash
  const blurhashTag = tags.find((t) => t[0] === 'blurhash');
  const blurhash = blurhashTag?.[1];

  // Group association
  const groupTag = tags.find((t) => t[0] === 'h');
  const groupId = groupTag?.[1];

  return {
    id: event.id,
    pubkey: event.pubkey,
    name,
    url,
    mimeType,
    size,
    hash,
    thumbnail,
    dimensions,
    blurhash,
    groupId,
    createdAt: event.created_at || Math.floor(Date.now() / 1000),
  };
}

interface UseRecentFilesOptions {
  /** Limit number of files */
  limit?: number;
  /** Filter by group */
  groupId?: string;
  /** Auto-subscribe on mount */
  autoSubscribe?: boolean;
  /**
   * Also list the user's Drive and Blossom files (default: on, except for a
   * group's files, which those services do not hold). Blossom needs a signed
   * request, so this runs only where the widget is actually shown.
   */
  includeServices?: boolean;
}

interface ServiceFiles {
  items: FileMetadata[];
  isLoading: boolean;
  error: string | null;
  /** The key these items were listed for. Items for any other key are never shown. */
  owner: string | null;
}

/** Shown when no signer appears, so the services cannot be listed. */
export const SIGNER_NOT_READY =
  'Could not list your Drive and Cloistr Files: your signer is not connected. Try again once it is.';

/**
 * Hook for subscribing to recent files
 * Returns files sorted by most recent first
 */
export function useRecentFiles(options: UseRecentFilesOptions = {}): WidgetState<FileMetadata> & {
  refresh: () => void;
} {
  const { limit = MAX_FILES, groupId, autoSubscribe = true, includeServices = !groupId } = options;
  const { signer } = useHeadlessAdapters();
  const { subscribe, isConnected } = useNdk();
  const unreachable = useUnreachable(isConnected);
  const { pubkey, isAuthenticated } = useAuthStore();

  // `owner` is the key the relay items were read for. A key switch keeps the
  // previous key's items in state until the new read answers, so rendering is
  // filtered on it: one account must never see another's file list.
  const [stored, setState] = useState<WidgetState<FileMetadata> & { owner: string | null }>({
    items: [],
    isLoading: true,
    error: null,
    lastUpdated: null,
    owner: null,
  });

  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const filesMapRef = useRef<Map<string, FileMetadata>>(new Map());

  const startSubscription = useCallback(() => {
    if (!subscribe || !isConnected || !pubkey) {
      // Not connected is not "nothing here": stay loading, and useUnreachable
      // turns it into an error if the connection does not come.
      setState((prev) => ({ ...prev, isLoading: true }));
      return;
    }

    // Clean up existing subscription
    subscriptionRef.current?.unsubscribe();
    filesMapRef.current.clear();

    // A read for a new key starts empty and owned by that key, so a later
    // EOSE cannot claim the previous key's items. The same key keeps its items
    // on screen while it re-reads.
    setState((prev) => ({
      ...prev,
      items: prev.owner === pubkey ? prev.items : [],
      owner: pubkey,
      isLoading: true,
      error: null,
    }));

    // Build filter for user's files
    const filter: NDKFilter = {
      kinds: [FILE_METADATA_KIND as number],
      authors: [pubkey],
      limit: limit * 2, // Fetch extra for deduplication
    };

    // Add group filter if specified
    if (groupId) {
      filter['#h'] = [groupId];
    }

    try {
      const tracked = trackAnswers({
        onEvent: (event: NDKEvent) => {
        const file = parseFileEvent(event);
        if (!file) return;

        filesMapRef.current.set(file.id, file);

        // Sort by created_at descending and limit
        const sortedFiles = Array.from(filesMapRef.current.values())
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, limit);

        setState({
          items: sortedFiles,
          isLoading: false,
          error: null,
          lastUpdated: Date.now(),
          owner: pubkey,
        });
      },
        onEose: () => {
        setState((prev) => ({
          ...prev,
          owner: pubkey,
          isLoading: false,
          lastUpdated: Date.now(),
        }));
      },
      }, () =>
        // Nobody answered: an error, never "nothing here". Items that did arrive stay.
        setState((prev) => ({
          ...prev,
          owner: pubkey,
          isLoading: false,
          error: prev.owner === pubkey && prev.items.length ? prev.error : NO_RELAY_ANSWERED,
        }))
      );
      const subscription = subscribeStream(subscribe, [filter], tracked.handlers, { closeOnEose: false });




      subscriptionRef.current = {
        unsubscribe: () => {
          tracked.cancel();
          subscription.stop();
        },
      };
    } catch (err) {
      setState({
        items: [],
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch files',
        lastUpdated: Date.now(),
        owner: pubkey,
      });
    }
  }, [subscribe, isConnected, pubkey, limit, groupId]);

  // Auto-subscribe on mount
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (autoSubscribe && isAuthenticated && isConnected) {
      // Defer to avoid sync setState in effect
      timeoutId = setTimeout(() => {
        startSubscription();
      }, 0);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      subscriptionRef.current?.unsubscribe();
    };
  }, [autoSubscribe, isAuthenticated, isConnected, startSubscription]);

  // Drive and Blossom. Either failing is an error, never "no files"; a
  // Blossom refusal is not cached, so refresh asks again.
  const [services, setServices] = useState<ServiceFiles>({
    items: [],
    isLoading: includeServices,
    error: null,
    owner: null,
  });
  // A signer that never appears is an error, not an endless skeleton. It is
  // given the same grace as a relay connection, since it comes up with NDK.
  const signerMissing = useUnreachable(!!signer);
  const [servicesRun, setServicesRun] = useState(0);

  useEffect(() => {
    if (!includeServices || !pubkey || !signer) return;
    let cancelled = false;
    const start = setTimeout(() => {
      setServices((prev) => ({ ...prev, isLoading: true, error: null }));
      void Promise.allSettled([listDriveFiles(pubkey), listBlossomFiles(signer, pubkey)]).then(
        ([drive, blossom]) => {
          if (cancelled) return;
          const failures: string[] = [];
          if (drive.status === 'rejected') failures.push(`Drive: ${sentence(reason(drive.reason))}`);
          if (blossom.status === 'rejected') failures.push(`Cloistr Files: ${sentence(reason(blossom.reason))}`);
          setServices({
            owner: pubkey,
            items: [
              ...(drive.status === 'fulfilled' ? drive.value : []),
              ...(blossom.status === 'fulfilled' ? blossom.value : []),
            ],
            isLoading: false,
            error: failures.length ? `Could not list all your files. ${failures.join(' ')}` : null,
          });
        }
      );
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [includeServices, pubkey, signer, servicesRun]);

  const refresh = useCallback(() => {
    startSubscription();
    setServicesRun((n) => n + 1);
  }, [startSubscription]);

  // Another key's state is never shown, and is not an answer for this key:
  // until this key's read settles the widget is loading, never "No files yet".
  const state = stored.owner === pubkey ? stored : { ...stored, items: [], isLoading: true, error: null };
  const relays = withReachability(state, unreachable);
  const servicesMine = services.owner === pubkey;
  const serviceItems = servicesMine ? services.items : [];
  const items = mergeFiles([relays.items, serviceItems], limit);
  const noSigner = includeServices && !!pubkey && !signer;
  const servicesPending = includeServices && (noSigner ? !signerMissing : !servicesMine || services.isLoading);
  const servicesError = noSigner ? (signerMissing ? SIGNER_NOT_READY : null) : servicesMine ? services.error : null;
  const isLoading = items.length === 0 && (relays.isLoading || servicesPending);
  return {
    items,
    isLoading,
    // With files to show, a source that failed does not hide them.
    error: items.length === 0 && !isLoading ? (relays.error ?? (includeServices ? servicesError : null)) : null,
    lastUpdated: relays.lastUpdated,
    refresh,
  };
}

/** End a message with a full stop, so two failures read as two sentences. */
function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
