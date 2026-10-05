/**
 * @fileoverview NDK-backed SignerInterface + RelayClient for the pure modules.
 *
 * The pure modules (groupService, threadPublish, noteService) take a signer and
 * a relay so a headless caller can supply its own. This hook is the browser's
 * supply: the signer signs through NDK's signer WITHOUT publishing, and the
 * relay publishes an already-signed event and reports how many relays took it.
 *
 * Keeping the two jobs separate is the point. The adapters this replaced
 * published from inside signEvent and had relay.publish return a constant 1,
 * so "no relay accepted it" and "published" were the same value by the time it
 * reached the pure layer, and the pure layer's zero-acceptance check could
 * never fire.
 */

import { useMemo } from 'react';
import type { Event, UnsignedEvent } from 'nostr-tools';
import { useAuthStore } from '@/stores/authStore';
import type { SignerInterface, RelayClient } from '../headless';
import { useNdk } from './NdkProvider';
import type { NDKFilter } from './ndk';

export interface HeadlessAdapters {
  /** Null until there is a pubkey and an NDK instance to sign with. */
  signer: SignerInterface | null;
  /** Null until NDK exists. Publishing still needs a connection to succeed. */
  relay: RelayClient | null;
}

export function useHeadlessAdapters(): HeadlessAdapters {
  const { createEvent, publish, fetchFromOwnRelays } = useNdk();
  const { pubkey } = useAuthStore();

  const signer = useMemo<SignerInterface | null>(() => {
    if (!pubkey || !publish) return null;
    return {
      getPublicKey: async () => pubkey,
      signEvent: async (unsigned: UnsignedEvent): Promise<Event> => {
        const event = createEvent();
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
  }, [pubkey, createEvent, publish]);

  const relay = useMemo<RelayClient | null>(() => {
    if (!publish) return null;
    return {
      publish: async (raw: Event) => {
        const event = createEvent();
        if (!event) throw new Error('Not connected');
        event.kind = raw.kind;
        event.content = raw.content;
        event.tags = raw.tags;
        event.created_at = raw.created_at;
        event.pubkey = raw.pubkey;
        event.id = raw.id;
        event.sig = raw.sig;
        const accepted = await publish(event);
        return accepted.size;
      },
      fetch: async (filter: Record<string, unknown>) => {
        if (!fetchFromOwnRelays) throw new Error('Not connected');
        const events = await fetchFromOwnRelays(filter as NDKFilter);
        return Array.from(events, (e) => e.rawEvent() as Event);
      },
    };
  }, [createEvent, publish, fetchFromOwnRelays]);

  return { signer, relay };
}
