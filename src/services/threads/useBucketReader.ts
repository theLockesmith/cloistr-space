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
import { useAuth } from '@/components/auth/AuthProvider';
import { type ThreadKeyStore } from './threadKeyStore';
import { useThreadKeyStore } from './useThreadKeyStore';
import { saveThreadKey, type StorageAdapter } from './threadKeyPersistence';
import { signerHandoffBuckets } from './signerEcdh';
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
  parseHandoffPayload,
  type UnwrappedMessage,
  type UnwrappedHandoff,
} from './giftWrap';

export interface BucketReaderDebug {
  hasSigner: boolean;
  isNip46: boolean;
  granterCount: number;
  handoffBuckets: string[];
  realBuckets: string[];
  windowId: number;
  signerError: string | null;
}

export interface BucketReaderReturn {
  messages: UnwrappedMessage[];
  handoffs: UnwrappedHandoff[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  debug: BucketReaderDebug;
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
  const { signer } = useAuth();
  const keyStore = useThreadKeyStore();

  const [messages, setMessages] = useState<UnwrappedMessage[]>([]);
  const [handoffs, setHandoffs] = useState<UnwrappedHandoff[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [debug, setDebug] = useState<BucketReaderDebug>({
    hasSigner: false,
    isNip46: false,
    granterCount: 0,
    handoffBuckets: [],
    realBuckets: [],
    windowId: 0,
    signerError: null,
  });

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

    // Buckets that carry hand-offs addressed to this reader. A signer user can
    // only open a wrap through a signer round trip, so we try that only for
    // wraps in these buckets, never for every message-bucket wrap.
    const handoffBuckets = new Set<string>();
    if (recipientSecret) {
      for (const w of [currWindow, prevWindow]) {
        for (const g of granterPubkeys) handoffBuckets.add(computeHandoffBucket(ecdhHex(recipientSecret, g), w));
      }
    }

    // Accept a thread key from a hand-off. A NEW key restarts the subscription,
    // because the message buckets it was opened with did not include this
    // thread's bucket; without the restart the key arrives and no message does.
    const acceptHandoff = (
      handoff: UnwrappedHandoff,
      ownerPk: string,
      encryptFn: (pk: string, pt: string) => Promise<string>,
    ) => {
      const threadPk = getPublicKey(hexToBytes(handoff.threadSecretHex));
      const isNew = !keyStore.get(threadPk);
      keyStore.set(threadPk, hexToBytes(handoff.threadSecretHex));
      handoffsRef.current.set(handoff.wrapId, handoff);
      setHandoffs(Array.from(handoffsRef.current.values()));
      let storage: StorageAdapter | null = null;
      try { storage = localStorage; } catch { /* unavailable */ }
      if (storage) {
        saveThreadKey(threadPk, handoff.threadSecretHex, ownerPk, encryptFn, storage).catch(() => {});
      }
      if (isNew) setRefreshKey((k) => k + 1);
    };

    const realCurr = computeRealBuckets(keyStore, currWindow, recipientSecret, granterPubkeys);
    const realPrev = computeRealBuckets(keyStore, prevWindow, recipientSecret, granterPubkeys);

    const doSubscribe = (allReal: string[]) => {
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
                granterPubkeys,
              );
              if (handoff) {
                const ownerPk = getPublicKey(recipientSecret);
                const ck = nip44.v2.utils.getConversationKey(recipientSecret, ownerPk);
                acceptHandoff(handoff, ownerPk, async (_pk: string, pt: string) => nip44.v2.encrypt(pt, ck));
              }
            } else if (signer?.nip44Decrypt && signer.nip44Encrypt) {
              // Signer (NIP-46) users hold no raw key: open the hand-off through
              // the signer. Until 2026-09-28 this branch did not exist, so every
              // signer user's hand-off was found and silently dropped.
              const bucket = event.tags.find((t) => t[0] === 't')?.[1];
              if (bucket && handoffBuckets.has(bucket)) {
                const decrypt = signer.nip44Decrypt.bind(signer);
                const encrypt = signer.nip44Encrypt.bind(signer);
                void (async () => {
                  try {
                    const plaintext = await decrypt(event.pubkey, event.content);
                    const handoff = parseHandoffPayload(plaintext, event.id, granterPubkeys);
                    if (!handoff) return;
                    const ownerPk = await signer.getPublicKey();
                    acceptHandoff(handoff, ownerPk, encrypt);
                  } catch {
                    // Not addressed to us (shared bucket) or the signer refused.
                  }
                })();
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
    };

    const localReal = Array.from(new Set([...realCurr, ...realPrev]));

    if (!recipientSecret && signer && granterPubkeys.length > 0) {
      const hasReq = typeof (signer as unknown as Record<string, unknown>).sendRequest === 'function';
      setDebug(prev => ({
        ...prev,
        hasSigner: true,
        isNip46: hasReq,
        granterCount: granterPubkeys.length,
        windowId: currWindow,
      }));
      Promise.all([
        signerHandoffBuckets(signer, granterPubkeys, currWindow),
        signerHandoffBuckets(signer, granterPubkeys, prevWindow),
      ]).then(([currHB, prevHB]) => {
        const allHB = [...currHB, ...prevHB];
        for (const b of allHB) handoffBuckets.add(b);
        const allReal = Array.from(new Set([...localReal, ...allHB]));
        setDebug(prev => ({
          ...prev,
          handoffBuckets: allHB,
          realBuckets: allReal,
          signerError: null,
        }));
        doSubscribe(allReal);
      }).catch((e) => {
        setDebug(prev => ({
          ...prev,
          signerError: e instanceof Error ? e.message : String(e),
        }));
        doSubscribe(localReal);
      });
      return;
    }

    setDebug(prev => ({
      ...prev,
      hasSigner: !!signer,
      isNip46: false,
      granterCount: granterPubkeys.length,
      windowId: currWindow,
      realBuckets: localReal,
    }));

    doSubscribe(localReal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubscribe, subscribe, recipientSecret, signer, granterKey, keyStore]);

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
    debug,
  };
}

// Re-export for the module; getPublicKey is used inside the hook
import { getPublicKey } from 'nostr-tools';
