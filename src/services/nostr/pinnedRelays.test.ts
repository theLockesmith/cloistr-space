/**
 * @fileoverview A probe and a publisher pinned to one relay set.
 *
 * Review of !227: the member-list repair checked the configured relays, but a
 * publish goes wherever NDK routes it (the author's outbox relays, relays for
 * the tagged pubkeys, every connected relay). A member list on a relay outside
 * the checked set could be replaced without having been seen. Pinning both to
 * the same URLs makes "checked" and "written" the same set by construction.
 */

import { describe, it, expect } from 'vitest';
import type { Event } from 'nostr-tools';
import { pinRelays, type PinnableService } from './pinnedRelays';

function fakeService() {
  const calls = { probed: [] as string[][], publishedTo: [] as string[][] };
  const service: PinnableService = {
    getRelaySetFor: (urls) => (urls.length ? ({ urls } as never) : undefined),
    probeRelays: async (urls) => {
      calls.probed.push(urls);
      return urls.map((url) => ({ url, status: 'answered' as const, events: [] }));
    },
    publish: async (_event, relaySet) => {
      calls.publishedTo.push((relaySet as unknown as { urls: string[] } | undefined)?.urls ?? ['<NDK routing>']);
      return new Set([{}]) as never;
    },
    createEvent: () => ({ rawEvent: () => ({}) }) as never,
  };
  return { service, calls };
}

const signed = { id: 'e', pubkey: 'p', kind: 39002, content: '', tags: [], created_at: 1, sig: 's' } as Event;

describe('pinRelays', () => {
  it('probes and publishes to exactly the same relays', async () => {
    const { service, calls } = fakeService();
    const urls = ['wss://outbox.example', 'wss://configured.example'];
    const { probe, relay } = pinRelays(service, urls);

    await probe({ kinds: [39002] });
    await relay.publish(signed);

    expect(calls.probed).toEqual([urls]);
    expect(calls.publishedTo).toEqual([urls]);
  });

  it('refuses to publish rather than fall back to NDK routing when there is no set', async () => {
    const { service, calls } = fakeService();
    const { relay } = pinRelays(service, []);
    await expect(relay.publish(signed)).rejects.toThrow();
    expect(calls.publishedTo).toEqual([]);
  });

  it('fetch reads the same pinned relays', async () => {
    const { service, calls } = fakeService();
    const { relay } = pinRelays(service, ['wss://a.example']);
    await relay.fetch({ kinds: [39002] });
    expect(calls.probed).toEqual([['wss://a.example']]);
  });
});
