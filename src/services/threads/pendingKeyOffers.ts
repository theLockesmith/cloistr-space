/**
 * Thread keys someone offered that the user has not accepted yet.
 *
 * Two paths deliver a thread key, and neither proves the sender is someone
 * the user should take a key from:
 *  - a gift-wrapped hand-off (kind 1059) is signed by a throwaway key, and
 *    its granter is only a claim inside the payload;
 *  - a key-wrap (kind 24242) is signed by its real sender, but anyone can
 *    publish one tagged to any pubkey.
 * Taking a key puts the sender's thread in the user's mailbox, so outside
 * the configured fleet granters the user decides.
 *
 * Refused offers are remembered on this device by event id.
 */
import { useSyncExternalStore } from 'react';
import { getPublicKey } from 'nostr-tools';
import { hexToBytes } from 'nostr-tools/utils';
import type { ThreadKeyStore } from './threadKeyStore';
import { saveThreadKey } from './threadKeyPersistence';

const DISMISSED_KEY = 'cloistr.threads.dismissedHandoffs';

/** Event ids of offers the user refused on this device. */
export function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveDismissed(eventId: string): void {
  try {
    const ids = loadDismissed();
    ids.add(eventId);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Storage unavailable: the offer comes back on the next load.
  }
}

/** A kind 24242 key-wrap from a sender outside the fleet granters. */
export interface PendingKeyWrap {
  eventId: string;
  threadPubkey: string;
  secretHex: string;
  /** Signed sender of the key-wrap: authentic, but not someone we trust. */
  senderPubkey: string;
}

let offers = new Map<string, PendingKeyWrap>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function offerKeyWrap(offer: PendingKeyWrap): void {
  if (offers.has(offer.eventId) || loadDismissed().has(offer.eventId)) return;
  // The d-tag names the thread; a secret for some other thread is malformed.
  if (getPublicKey(hexToBytes(offer.secretHex)) !== offer.threadPubkey) return;
  offers = new Map(offers).set(offer.eventId, offer);
  emit();
}

/** Remove an offer and return it (to accept it), or null if it is gone. */
export function takeKeyWrap(eventId: string): PendingKeyWrap | null {
  const offer = offers.get(eventId) ?? null;
  if (!offer) return null;
  offers = new Map(offers);
  offers.delete(eventId);
  emit();
  return offer;
}

/**
 * Take an offered key into the store, and persist it the way accepted keys
 * are, so it survives a reload. Returns false if the offer is gone.
 */
export function acceptKeyWrap(
  eventId: string,
  store: ThreadKeyStore,
  ownerPubkey: string | null,
  encrypt: ((pk: string, pt: string) => Promise<string>) | undefined,
): boolean {
  const offer = takeKeyWrap(eventId);
  if (!offer) return false;
  store.importHex(offer.threadPubkey, offer.secretHex);
  if (ownerPubkey && encrypt) {
    try {
      void saveThreadKey(offer.threadPubkey, offer.secretHex, ownerPubkey, encrypt, localStorage).catch(() => {});
    } catch {
      // Storage unavailable: the key lasts for this session.
    }
  }
  return true;
}

export function dismissKeyWrap(eventId: string): void {
  saveDismissed(eventId);
  takeKeyWrap(eventId);
}

/** Drop every offer (logout: they were addressed to the previous user). */
export function clearKeyWraps(): void {
  if (offers.size === 0) return;
  offers = new Map();
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => offers;

export function usePendingKeyWraps(): PendingKeyWrap[] {
  return Array.from(useSyncExternalStore(subscribe, snapshot, snapshot).values());
}
