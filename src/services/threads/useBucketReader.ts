/**
 * Bucket-based subscription and trial decryption for sealed threads.
 *
 * Subscribes to K=16 buckets for both current AND previous window (the kit
 * publishes into the current window but a message near midnight may arrive
 * after the window rotates). since = previous window start.
 *
 * Every incoming kind 1059 event is tried against each held thread key.
 * Whatever opens is a message for one of the reader's threads.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { hexToBytes } from 'nostr-tools/utils';
import { bytesToHex } from 'nostr-tools/utils';
import { nip44 } from 'nostr-tools';
import { useNdk, subscribeStream, type NDKEvent } from '@/services/nostr';
import { type ThreadKeyStore } from './threadKeyStore';
import { useThreadKeyStore } from './useThreadKeyStore';
import { saveThreadKey, type StorageAdapter } from './threadKeyPersistence';
import {
  getWindowId,
  computeThreadBucket,
  computeHandoffBucket,
  ecdhHex,
  generateBucketSet,
  WINDOW_SECONDS,
} from './bucketCrypto';
import {
  GIFT_WRAP_KIND,
  tryUnwrapMessage,
  tryUnwrapHandoff,
  type UnwrappedMessage,
  type UnwrappedHandoff,
} from './giftWrap';

export interface BucketReaderReturn {
  messages: UnwrappedMessage[];
  handoffs: UnwrappedHandoff[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Compute the real buckets a reader needs for a given window.
 * Returns hex string bucket values.
 */
export function computeRealBuckets(
  keyStore: ThreadKeyStore,
  windowId: number,
  recipientSecret: Uint8Array | null,
  granterPubkeys: string[],
): string[] {
  const buckets = new Set<string>();

  for (const [, threadSk] of keyStore.entries()) {
    buckets.add(computeThreadBucket(bytesToHex(threadSk), windowId));
  }

  if (recipientSecret) {
    for (const granterPk of granterPubkeys) {
      const ecdh = ecdhHex(recipientSecret, granterPk);
      buckets.add(computeHandoffBucket(ecdh, windowId));
    }
  }

  return Array.from(buckets);
}

/**
 * Subscribe to bucketed gift wraps and trial-decrypt them.
 */
export function useBucketReader(
  recipientSecret: Uint8Array | null,
  granterPubkeys: string[] = [],
): BucketReaderReturn {
  const { subscribe, isConnected } = useNdk();
  const keyStore = useThreadKeyStore();

  const [messages, setMessages] = useState<UnwrappedMessage[]>([]);
  const [handoffs, setHandoffs] = useState<UnwrappedHandoff[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const messagesRef = useRef(new Map<string, UnwrappedMessage>());
  const handoffsRef = useRef(new Map<string, UnwrappedHandoff>());
  const subRef = useRef<{ unsubscribe: () => void } | null>(null);

  const canSubscribe = Boolean(subscribe && isConnected);
  const granterKey = granterPubkeys.slice().sort().join(',');

  const startSubscription = useCallback(() => {
    if (!canSubscribe || !subscribe) return;

    subRef.current?.unsubscribe();
    messagesRef.current.clear();
    handoffsRef.current.clear();
    setMessages([]);
    setHandoffs([]);
    setIsFetching(true);
    setError(null);

    const now = Math.floor(Date.now() / 1000);
    const currWindow = getWindowId(now);
    const prevWindow = currWindow - 1;
    const since = prevWindow * WINDOW_SECONDS;

    // Collect real buckets from both current and previous window
    const realCurr = computeRealBuckets(keyStore, currWindow, recipientSecret, granterPubkeys);
    const realPrev = computeRealBuckets(keyStore, prevWindow, recipientSecret, granterPubkeys);
    const allReal = Array.from(new Set([...realCurr, ...realPrev]));
    const bucketSet = generateBucketSet(allReal);

    const filter: NDKFilter = {
      kinds: [GIFT_WRAP_KIND as number],
      '#t': bucketSet,
      since,
    };

    try {
      const subscription = subscribeStream(subscribe, [filter], {
        onEvent: (event: NDKEvent) => {
          if (messagesRef.current.has(event.id) || handoffsRef.current.has(event.id)) return;

          const msg = tryUnwrapMessage(
            { id: event.id, pubkey: event.pubkey, content: event.content, tags: event.tags },
            keyStore,
          );
          if (msg) {
            messagesRef.current.set(msg.wrapId, msg);
            setMessages(Array.from(messagesRef.current.values()));
            setIsFetching(false);
            return;
          }

          if (recipientSecret) {
            const handoff = tryUnwrapHandoff(
              { id: event.id, pubkey: event.pubkey, content: event.content },
              recipientSecret,
            );
            if (handoff) {
              const threadPk = getPublicKey(hexToBytes(handoff.threadSecretHex));
              keyStore.set(threadPk, hexToBytes(handoff.threadSecretHex));
              handoffsRef.current.set(handoff.wrapId, handoff);
              setHandoffs(Array.from(handoffsRef.current.values()));

              // Persist the new key at rest, encrypted to our own pubkey
              if (recipientSecret) {
                const ownerPk = getPublicKey(recipientSecret);
                const ck = nip44.v2.utils.getConversationKey(recipientSecret, ownerPk);
                const encrypt = async (_pk: string, pt: string) =>
                  nip44.v2.encrypt(pt, ck);
                let storage: StorageAdapter | null = null;
                try { storage = localStorage; } catch { /* unavailable */ }
                if (storage) {
                  saveThreadKey(threadPk, handoff.threadSecretHex, ownerPk, encrypt, storage)
                    .catch(() => {});
                }
              }
            }
          }

          setIsFetching(false);
        },
        onEose: () => setIsFetching(false),
      }, { closeOnEose: false });

      subRef.current = { unsubscribe: () => subscription.stop() };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bucket subscription failed');
      setIsFetching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubscribe, subscribe, recipientSecret, granterKey, keyStore]);

  useEffect(() => {
    const timeoutId = setTimeout(() => startSubscription(), 0);
    return () => {
      clearTimeout(timeoutId);
      subRef.current?.unsubscribe();
    };
  }, [startSubscription, refreshKey]);

  useEffect(() => {
    const now = Math.floor(Date.now() / 1000);
    const wid = getWindowId(now);
    const nextWindowStart = (wid + 1) * WINDOW_SECONDS;
    const msUntilNext = (nextWindowStart - now) * 1000 + 1000;

    const timer = setTimeout(() => setRefreshKey((k) => k + 1), msUntilNext);
    return () => clearTimeout(timer);
  }, [refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return {
    messages,
    handoffs,
    isLoading: canSubscribe && isFetching,
    error,
    refresh,
  };
}

// Re-export for the module; getPublicKey is used inside the hook
import { getPublicKey } from 'nostr-tools';
