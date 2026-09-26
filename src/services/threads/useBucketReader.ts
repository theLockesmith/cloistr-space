/**
 * @fileoverview Bucket-based subscription and trial decryption for sealed threads.
 *
 * Subscribes to K=16 buckets per window. Real buckets come from held thread
 * keys (for messages) and ECDH with expected granters (for key handoffs).
 * Random padding fills the rest so every reader's subscription looks identical.
 *
 * Every incoming kind 1059 event is tried against each held thread key.
 * Whatever opens is a message for one of the reader's threads. Events that
 * don't open as messages are tried as key handoffs.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { nip44 } from 'nostr-tools';
import { hexToBytes } from 'nostr-tools/utils';
import { useNdk, subscribeStream, type NDKEvent } from '@/services/nostr';
import { type ThreadKeyStore } from './threadKeyStore';
import { useThreadKeyStore } from './useThreadKeyStore';
import {
  getWindowId,
  computeThreadBucket,
  computeHandoffBucket,
  generateBucketSet,
  bucketToTag,
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
  /** Decrypted thread messages. */
  messages: UnwrappedMessage[];
  /** Key handoffs received. Each one has already been added to the key store. */
  handoffs: UnwrappedHandoff[];
  isLoading: boolean;
  error: string | null;
  /** Force a resubscription (recomputes buckets, refetches). */
  refresh: () => void;
}

/**
 * Compute the real buckets a reader needs for a given window.
 *
 * Pure, exported for testing.
 *
 * @param keyStore        Thread keys held
 * @param windowId        Current window
 * @param recipientSecret Reader's secret key (for ECDH handoff buckets)
 * @param granterPubkeys  Keys the reader expects handoffs from
 */
export function computeRealBuckets(
  keyStore: ThreadKeyStore,
  windowId: number,
  recipientSecret: Uint8Array | null,
  granterPubkeys: string[],
): number[] {
  const buckets = new Set<number>();

  for (const [, threadSk] of keyStore.entries()) {
    buckets.add(computeThreadBucket(threadSk, windowId));
  }

  if (recipientSecret) {
    for (const granterPk of granterPubkeys) {
      const shared = nip44.v2.utils.getConversationKey(recipientSecret, granterPk);
      buckets.add(computeHandoffBucket(shared, windowId));
    }
  }

  return Array.from(buckets);
}

/**
 * Subscribe to bucketed gift wraps and trial-decrypt them.
 *
 * @param recipientSecret  Reader's 32-byte secret key. Required for handoff
 *   discovery; without it, only messages for already-held thread keys are read.
 * @param granterPubkeys   Keys the reader expects handoffs from.
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

  // Content identity so a new array with the same keys doesn't resubscribe
  const granterKey = granterPubkeys.slice().sort().join(',');

  // Extracted into a callback so the state resets (setMessages, setIsFetching,
  // etc.) are not synchronous setState calls inside the effect body. Same
  // pattern as useThreads.
  const startSubscription = useCallback(() => {
    if (!canSubscribe || !subscribe) return;

    subRef.current?.unsubscribe();
    messagesRef.current.clear();
    handoffsRef.current.clear();
    setMessages([]);
    setHandoffs([]);
    setIsFetching(true);
    setError(null);

    const windowId = getWindowId();
    const realBuckets = computeRealBuckets(keyStore, windowId, recipientSecret, granterPubkeys);
    const bucketSet = generateBucketSet(realBuckets);
    const bucketTags = bucketSet.map(bucketToTag);

    const filter: NDKFilter = {
      kinds: [GIFT_WRAP_KIND as number],
      '#bucket': bucketTags,
    };

    try {
      const subscription = subscribeStream(subscribe, [filter], {
        onEvent: (event: NDKEvent) => {
          if (messagesRef.current.has(event.id) || handoffsRef.current.has(event.id)) return;

          // Try as thread message first
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

          // Try as key handoff
          if (recipientSecret) {
            const handoff = tryUnwrapHandoff(
              { id: event.id, pubkey: event.pubkey, content: event.content },
              recipientSecret,
            );
            if (handoff) {
              keyStore.set(handoff.threadPubkey, hexToBytes(handoff.threadSecretHex));
              handoffsRef.current.set(handoff.wrapId, handoff);
              setHandoffs(Array.from(handoffsRef.current.values()));
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
    // granterKey is the content identity of granterPubkeys
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubscribe, subscribe, recipientSecret, granterKey, keyStore]);

  useEffect(() => {
    const timeoutId = setTimeout(() => startSubscription(), 0);
    return () => {
      clearTimeout(timeoutId);
      subRef.current?.unsubscribe();
    };
  }, [startSubscription, refreshKey]);

  // Resubscribe when the window rotates (buckets change daily)
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
