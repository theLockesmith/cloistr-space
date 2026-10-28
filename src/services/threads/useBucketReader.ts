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
import { loadDismissed, saveDismissed } from './pendingKeyOffers';
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

/**
 * A thread key someone offered by hand-off, held back until the user accepts
 * it. Nothing in a gift-wrapped hand-off authenticates the granter: the wrap
 * is signed by a throwaway key and `g` is just a claim inside the payload, so
 * anyone can send a key that claims to come from a trusted granter. Accepting
 * one would put a stranger's thread in the user's mailbox under a trusted
 * name. Until hand-offs are authenticated, the user decides.
 */
export interface PendingHandoff extends UnwrappedHandoff {
  /** Public key of the offered thread key (hex). */
  threadPubkey: string;
}

export interface BucketReaderReturn {
  messages: UnwrappedMessage[];
  /** Hand-offs whose key the user holds (accepted now or earlier). */
  handoffs: UnwrappedHandoff[];
  /** Hand-offs for keys the user does not hold, waiting for acceptance. */
  pendingHandoffs: PendingHandoff[];
  /** Take the offered key into the key store and start reading its thread. */
  acceptHandoff: (wrapId: string) => void;
  /** Refuse the offered key; it is not offered again on this device. */
  dismissHandoff: (wrapId: string) => void;
  /**
   * True when this reader could not look for hand-offs at all: a signer user
   * whose signer cannot work out the hand-off buckets. Then "no offers" means
   * "never looked", and the screen has to say so rather than "no threads".
   */
  handoffLookupUnavailable: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  debug: BucketReaderDebug;
}

/** How long to wait for the relays to finish before showing what has arrived. */
export const EOSE_FALLBACK_MS = 10_000;

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

function persistKey(
  threadPubkey: string,
  secretHex: string,
  ownerPk: string,
  encryptFn: (pk: string, pt: string) => Promise<string>,
  threadId?: string,
): void {
  let storage: StorageAdapter | null = null;
  try { storage = localStorage; } catch { /* unavailable */ }
  if (storage) {
    saveThreadKey(threadPubkey, secretHex, ownerPk, encryptFn, storage, threadId || undefined).catch(() => {});
  }
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

  const [pendingHandoffs, setPendingHandoffs] = useState<PendingHandoff[]>([]);
  const [handoffLookupUnavailable, setHandoffLookupUnavailable] = useState(false);

  const messagesRef = useRef(new Map<string, UnwrappedMessage>());
  const handoffsRef = useRef(new Map<string, UnwrappedHandoff>());
  const pendingRef = useRef(
    new Map<string, {
      handoff: PendingHandoff;
      ownerPk: string;
      encryptFn: (pk: string, pt: string) => Promise<string>;
      /** Wrap ids of re-sent hand-offs for the same thread. */
      copies: string[];
    }>(),
  );
  const subRef = useRef<{ unsubscribe: () => void } | null>(null);
  // Who the pending offers were addressed to. A restart for the window timer
  // or a new key keeps them on screen; only a different reader drops them.
  const pendingForRef = useRef<{ recipientSecret: Uint8Array | null; signer: unknown } | null>(null);

  const canSubscribe = Boolean(subscribe && isConnected);
  const granterKey = granterPubkeys.slice().sort().join(',');

  const startSubscription = useCallback(() => {
    if (!canSubscribe || !subscribe) return;

    subRef.current?.unsubscribe();
    messagesRef.current.clear();
    handoffsRef.current.clear();
    const prevReader = pendingForRef.current;
    if (!prevReader || prevReader.recipientSecret !== recipientSecret || prevReader.signer !== signer) {
      pendingRef.current.clear();
      setPendingHandoffs([]);
    }
    pendingForRef.current = { recipientSecret, signer };
    // An offer made before the saved key finished restoring (a reload restores
    // keys through a signer round trip) is for a key now held: withdraw it.
    let withdrew = false;
    for (const [wrapId, p] of pendingRef.current) {
      if (keyStore.get(p.handoff.threadPubkey)) {
        pendingRef.current.delete(wrapId);
        withdrew = true;
      }
    }
    if (withdrew) setPendingHandoffs(Array.from(pendingRef.current.values(), (p) => p.handoff));
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

    // A hand-off for a key already held changes nothing and needs no prompt.
    // Any other key waits in pendingHandoffs until the user accepts it.
    const acceptHandoff = (
      handoff: UnwrappedHandoff,
      ownerPk: string,
      encryptFn: (pk: string, pt: string) => Promise<string>,
    ) => {
      const threadPubkey = getPublicKey(hexToBytes(handoff.threadSecretHex));
      if (keyStore.get(threadPubkey)) {
        handoffsRef.current.set(handoff.wrapId, handoff);
        setHandoffs(Array.from(handoffsRef.current.values()));
        // A key saved before names were kept: save it again WITH the name, once,
        // so the thread is still found after this hand-off leaves the relays.
        if (handoff.threadId && keyStore.setName(threadPubkey, handoff.threadId)) {
          persistKey(threadPubkey, handoff.threadSecretHex, ownerPk, encryptFn, handoff.threadId);
        }
        return;
      }
      if (loadDismissed().has(handoff.wrapId) || pendingRef.current.has(handoff.wrapId)) return;
      // The kit re-sends a thread's hand-off. One offer per thread: further
      // copies ride along on the first, so accepting or dismissing it settles
      // them all instead of the next identical card taking its place.
      for (const p of pendingRef.current.values()) {
        if (p.handoff.threadPubkey === threadPubkey) {
          p.copies.push(handoff.wrapId);
          return;
        }
      }
      pendingRef.current.set(handoff.wrapId, { handoff: { ...handoff, threadPubkey }, ownerPk, encryptFn, copies: [] });
      setPendingHandoffs(Array.from(pendingRef.current.values(), (p) => p.handoff));
    };

    // Which held keys own each subscribed bucket. A wrap sits in its thread's
    // bucket, so only those keys can open it; a decoy matches none and costs
    // nothing. Trying every key on every wrap froze the page for a user with
    // fifteen threads.
    const keysByBucket = new Map<string, Array<[string, Uint8Array]>>();
    for (const [threadPubkey, threadSk] of keyStore.entries()) {
      for (const w of [currWindow, prevWindow]) {
        const b = computeThreadBucket(bytesToHex(threadSk), w);
        const list = keysByBucket.get(b) ?? [];
        if (!list.some(([pk]) => pk === threadPubkey)) list.push([threadPubkey, threadSk]);
        keysByBucket.set(b, list);
      }
    }

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

            const bucket = event.tags.find((t) => t[0] === 't')?.[1];
            const candidates = (bucket && keysByBucket.get(bucket)) || [];
            const msg = candidates.length === 0 ? null : tryUnwrapMessage(
              { id: event.id, pubkey: event.pubkey, content: event.content, tags: event.tags, created_at: event.created_at },
              { entries: () => candidates.values() },
            );
            if (msg) {
              messagesRef.current.set(msg.wrapId, msg);
              setMessages(Array.from(messagesRef.current.values()));
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
          },
          // Loading ends when the relays have sent what they hold, never on the
          // first event: most wraps here are decoys or other threads' messages,
          // and ending on one showed 'No threads yet' while threads were still
          // arriving. A relay that never finishes is cut off after a bound.
          onEose: () => {
            clearTimeout(eoseFallback);
            setIsFetching(false);
          },
        }, { closeOnEose: false });
        const eoseFallback = setTimeout(() => setIsFetching(false), EOSE_FALLBACK_MS);

        subRef.current = {
          unsubscribe: () => {
            clearTimeout(eoseFallback);
            subscription.stop();
          },
        };
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
        setHandoffLookupUnavailable(allHB.length === 0);
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
        setHandoffLookupUnavailable(true);
        setDebug(prev => ({
          ...prev,
          signerError: e instanceof Error ? e.message : String(e),
        }));
        doSubscribe(localReal);
      });
      return;
    }

    setHandoffLookupUnavailable(false);
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

  // A key added from anywhere (storage restore, the key-wrap loader, a hand-off)
  // changes which buckets hold this reader's messages, so ask again.
  useEffect(() => keyStore.onKeyAdded(() => setRefreshKey((k) => k + 1)), [keyStore]);

  useEffect(() => {
    const now = Math.floor(Date.now() / 1000);
    const wid = getWindowId(now);
    const nextWindowStart = (wid + 1) * WINDOW_SECONDS;
    const msUntilNext = (nextWindowStart - now) * 1000 + 1000;

    const timer = setTimeout(() => setRefreshKey((k) => k + 1), msUntilNext);
    return () => clearTimeout(timer);
  }, [refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Taking the key restarts the subscription, because the message buckets it
  // was opened with did not include this thread's bucket; without the restart
  // the key arrives and no message does.
  const acceptPending = useCallback((wrapId: string) => {
    const entry = pendingRef.current.get(wrapId);
    if (!entry) return;
    const { handoff, ownerPk, encryptFn } = entry;
    pendingRef.current.delete(wrapId);
    setPendingHandoffs(Array.from(pendingRef.current.values(), (p) => p.handoff));
    if (handoff.threadId) keyStore.setName(handoff.threadPubkey, handoff.threadId);
    keyStore.set(handoff.threadPubkey, hexToBytes(handoff.threadSecretHex));
    handoffsRef.current.set(wrapId, handoff);
    setHandoffs(Array.from(handoffsRef.current.values()));
    persistKey(handoff.threadPubkey, handoff.threadSecretHex, ownerPk, encryptFn, handoff.threadId);
    setRefreshKey((k) => k + 1);
  }, [keyStore]);

  const dismissPending = useCallback((wrapId: string) => {
    const entry = pendingRef.current.get(wrapId);
    pendingRef.current.delete(wrapId);
    setPendingHandoffs(Array.from(pendingRef.current.values(), (p) => p.handoff));
    saveDismissed(wrapId);
    for (const copy of entry?.copies ?? []) saveDismissed(copy);
  }, []);

  return {
    messages,
    handoffs,
    pendingHandoffs,
    acceptHandoff: acceptPending,
    dismissHandoff: dismissPending,
    handoffLookupUnavailable,
    isLoading: canSubscribe && isFetching,
    error,
    refresh,
    debug,
  };
}

// Re-export for the module; getPublicKey is used inside the hook
import { getPublicKey } from 'nostr-tools';
