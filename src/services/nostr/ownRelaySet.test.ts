/**
 * @fileoverview Tests for pinning a query to the user's own relays.
 *
 * This guards a bug with no visible symptom at the call site and a total one in
 * the product: the operator has 468 follows sitting on relay.cloistr.xyz, and
 * Space showed them none.
 *
 * NDK routes ANY filter carrying `authors` purely by the author's relay list.
 * explicitRelayUrls is not consulted -- that is only the no-authors branch
 * (dist/index.js:2652-2692) -- and a connected relay is used only when its URL
 * appears in the author's own kind:10002, matched as an exact string
 * (chooseRelayCombinationForPubkeys, index.js:405).
 *
 * Correct for finding other people's notes. Wrong for a kind:33000 that exists
 * only on our relay by construction: the query can be sent everywhere except
 * the one place the data lives, and `fetchEvents` resolving empty is
 * indistinguishable from "this user follows nobody".
 *
 * Passing an explicit relaySet skips that calculation (index.js:9227), which is
 * what these tests pin.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NdkService } from './ndk';

// vi.mock is hoisted above ordinary consts, so the doubles have to be created
// inside vi.hoisted or the factory closes over uninitialised bindings.
const { fetchEvents, fromRelayUrls } = vi.hoisted(() => ({
  fetchEvents: vi.fn().mockResolvedValue(new Set()),
  fromRelayUrls: vi.fn((urls: string[]) => ({ relays: new Set(urls), urls })),
}));

vi.mock('@nostr-dev-kit/ndk', () => {
  const MockNDK = vi.fn().mockImplementation(() => ({
    // getRelay is part of the pool contract, not decoration: setConfiguredRelays
    // puts the user's resolved relays INTO the pool, which is what makes a
    // publish able to reach them. A pool double without it is not a pool.
    pool: { on: vi.fn(), relays: new Map(), getRelay: vi.fn() },
    outboxPool: { relays: new Map(), getRelay: vi.fn() },
    connect: vi.fn().mockResolvedValue(undefined),
    signer: undefined,
    subscribe: vi.fn(),
    fetchEvents,
  }));

  return {
    default: MockNDK,
    NDKUser: vi.fn(),
    NDKEvent: vi.fn(),
    NDKRelaySet: { fromRelayUrls },
  };
});

beforeEach(() => {
  fetchEvents.mockClear();
  fromRelayUrls.mockClear();
});

describe('getOwnRelaySet', () => {
  it('builds a set from the configured relays', () => {
    const service = new NdkService({
      explicitRelayUrls: ['wss://relay.cloistr.xyz'],
      autoConnect: false,
    });

    expect(service.getOwnRelaySet()).toBeDefined();
    expect(fromRelayUrls).toHaveBeenCalledWith(
      expect.arrayContaining(['wss://relay.cloistr.xyz']),
      expect.anything()
    );
  });

  it('returns undefined when nothing is configured', () => {
    // So callers fall back to NDK's routing rather than querying an EMPTY set
    // and getting silence -- which would turn a config gap into "you follow
    // nobody", the same collapse this whole fix is about.
    const service = new NdkService({ explicitRelayUrls: [], autoConnect: false });

    expect(service.getOwnRelaySet()).toBeUndefined();
  });

  it('tracks relays applied later', () => {
    // The user's relay list arrives after startup, via kind:10002 resolution.
    const service = new NdkService({ explicitRelayUrls: [], autoConnect: false });
    service.setConfiguredRelays(['wss://relay.cloistr.xyz']);

    expect(service.getOwnRelaySet()).toBeDefined();
  });
});

describe('fetchFromOwnRelays', () => {
  it('PASSES the relay set to NDK', async () => {
    // The assertion that matters. A relay set built and then not forwarded
    // looks identical to one that was never built -- which is exactly how the
    // dropped handler argument in NdkProvider stayed invisible.
    const service = new NdkService({
      explicitRelayUrls: ['wss://relay.cloistr.xyz'],
      autoConnect: false,
    });

    await service.fetchFromOwnRelays({ kinds: [33000 as number], authors: ['a'.repeat(64)] });

    expect(fetchEvents).toHaveBeenCalledTimes(1);
    const [filters, opts, relaySet] = fetchEvents.mock.calls[0];
    expect(filters).toEqual([{ kinds: [33000 as number], authors: ['a'.repeat(64)] }]);
    expect(opts).toBeUndefined();
    expect(relaySet).toBeDefined();
  });

  it('falls back to ordinary routing when no relays are configured', async () => {
    const service = new NdkService({ explicitRelayUrls: [], autoConnect: false });

    await service.fetchFromOwnRelays({ kinds: [33000 as number] });

    const [, , relaySet] = fetchEvents.mock.calls[0];
    expect(relaySet).toBeUndefined();
  });

  it('accepts a single filter or an array', async () => {
    const service = new NdkService({
      explicitRelayUrls: ['wss://relay.cloistr.xyz'],
      autoConnect: false,
    });

    await service.fetchFromOwnRelays([{ kinds: [1] }, { kinds: [7] }]);

    expect(fetchEvents.mock.calls[0][0]).toHaveLength(2);
  });
});
