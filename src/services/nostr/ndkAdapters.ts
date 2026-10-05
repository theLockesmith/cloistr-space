/**
 * @fileoverview NDK-backed SignerInterface + RelayClient, as a plain factory.
 *
 * useHeadlessAdapters memoizes this for components; non-React callers that
 * hold an NdkService (ContactsSyncService) call it directly, so there is one
 * adapter, not one per caller.
 *
 * The signer signs through NDK's signer WITHOUT publishing, and the relay
 * publishes an already-signed event and reports how many relays took it. The
 * adapters this replaced published from inside signEvent and had
 * relay.publish return a constant 1, so "no relay accepted it" and "published"
 * were the same value by the time it reached the pure layer.
 */

import type { Event, UnsignedEvent } from 'nostr-tools';
import type { SignerInterface, RelayClient } from '../headless';
import type { NDKEvent, NDKFilter, NDKRelay } from '@nostr-dev-kit/ndk';

export interface NdkSource {
  createEvent: () => NDKEvent | null;
  publish: ((event: NDKEvent) => Promise<Set<NDKRelay>>) | null;
  fetchFromOwnRelays: ((filter: NDKFilter) => Promise<Set<NDKEvent>>) | null;
}

export function makeNdkSigner(source: NdkSource, getPubkey: () => Promise<string>): SignerInterface {
  return {
    getPublicKey: getPubkey,
    signEvent: async (unsigned: UnsignedEvent): Promise<Event> => {
      const event = source.createEvent();
      if (!event) throw new Error('Not connected');
      event.kind = unsigned.kind;
      event.content = unsigned.content;
      event.tags = unsigned.tags;
      event.created_at = unsigned.created_at;
      event.pubkey = unsigned.pubkey;
      await event.sign();
      return event.rawEvent() as Event;
    },
    // No pure module encrypts through this signer yet. Throwing rather than
    // returning '' so the first one that does finds out immediately instead
    // of publishing empty ciphertext.
    encrypt: async () => {
      throw new Error('encrypt is not wired through the NDK adapter');
    },
    decrypt: async () => {
      throw new Error('decrypt is not wired through the NDK adapter');
    },
  };
}

export function makeNdkRelay(source: NdkSource): RelayClient {
  return {
    publish: async (raw: Event) => {
      const event = source.createEvent();
      if (!event || !source.publish) throw new Error('Not connected');
      event.kind = raw.kind;
      event.content = raw.content;
      event.tags = raw.tags;
      event.created_at = raw.created_at;
      event.pubkey = raw.pubkey;
      event.id = raw.id;
      event.sig = raw.sig;
      const accepted = await source.publish(event);
      return accepted.size;
    },
    fetch: async (filter: Record<string, unknown>) => {
      if (!source.fetchFromOwnRelays) throw new Error('Not connected');
      const events = await source.fetchFromOwnRelays(filter as NDKFilter);
      return Array.from(events, (e) => e.rawEvent() as Event);
    },
  };
}
