/**
 * @fileoverview A probe and a RelayClient pinned to one set of relay URLs.
 *
 * For writes that are only safe after checking every relay they will reach.
 * NDK routes a publish itself (the author's outbox relays, relays for tagged
 * pubkeys, every connected relay), so a check over any other set can miss the
 * event the publish replaces. Here the caller fixes the URLs once, and both
 * the check and the publish use exactly those. Never falls back to NDK's
 * routing: no set means no publish.
 */

import type { Event } from 'nostr-tools';
import type { NDKEvent, NDKFilter, NDKRelay, NDKRelaySet } from '@nostr-dev-kit/ndk';
import type { RelayAnswer, RelayClient, RelayProbe } from '../headless';

export interface PinnableService {
  getRelaySetFor(urls: string[]): NDKRelaySet | undefined;
  probeRelays(urls: string[], filter: NDKFilter, timeoutMs?: number): Promise<RelayAnswer[]>;
  publish(event: NDKEvent, relaySet?: NDKRelaySet): Promise<Set<NDKRelay>>;
  createEvent(): NDKEvent;
}

export function pinRelays(service: PinnableService, urls: string[]): { probe: RelayProbe; relay: RelayClient } {
  const probe: RelayProbe = (filter) => service.probeRelays(urls, filter as NDKFilter);
  const relay: RelayClient = {
    publish: async (raw: Event) => {
      const relaySet = service.getRelaySetFor(urls);
      if (!relaySet) throw new Error('No relays to publish to.');
      const event = service.createEvent();
      Object.assign(event, {
        kind: raw.kind,
        content: raw.content,
        tags: raw.tags,
        created_at: raw.created_at,
        pubkey: raw.pubkey,
        id: raw.id,
        sig: raw.sig,
      });
      return (await service.publish(event, relaySet)).size;
    },
    fetch: async (filter) =>
      (await probe(filter)).flatMap((a) => (a.status === 'answered' ? a.events : [])),
  };
  return { probe, relay };
}
