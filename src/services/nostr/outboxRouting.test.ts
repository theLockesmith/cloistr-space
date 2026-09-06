/**
 * @fileoverview Tests for where the outbox model LOOKS UP relay lists.
 *
 * The bug these pin had no visible symptom and a total one in the product: a
 * user curated a relay list on the Profile page, Space showed it back to them
 * as configured, and every note they wrote went to relay.cloistr.xyz and
 * nowhere else. Nothing errored.
 *
 * The mechanism is that NDK has TWO pools. The main pool is where a publish
 * goes; the OUTBOX pool is where NDK asks "which relays does this author write
 * to". They are separate, and the outbox one is built at construction from
 * `opts.outboxRelayUrls || DEFAULT_OUTBOX_RELAYS`, which is
 * ["wss://purplepag.es/", "wss://nos.lol/"] (dist/index.js:11246,11346).
 *
 * Space never passed the option. So the lookup asked two third-party indexers
 * that have never held a Cloistr user's kind:10002, got nothing, and NDK fell
 * back to pool.permanentAndConnectedRelays() -- the single explicit relay
 * (calculateRelaySetFromEvent, dist/index.js:2639). The relay editor wrote the
 * list to our relay; the resolver read from somewhere else; neither half looked
 * wrong on its own.
 *
 * Both halves are asserted here because they fail independently: the wrong
 * lookup pool is the root cause, and a setConfiguredRelays that updates
 * bookkeeping without touching either pool leaves the FALLBACK narrowed to one
 * relay even once the lookup is fixed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NdkService } from './ndk';

const { ndkOptions, poolGetRelay, outboxGetRelay } = vi.hoisted(() => ({
  ndkOptions: [] as Record<string, unknown>[],
  poolGetRelay: vi.fn(),
  outboxGetRelay: vi.fn(),
}));

vi.mock('@nostr-dev-kit/ndk', () => {
  const MockNDK = vi.fn().mockImplementation((opts: Record<string, unknown>) => {
    ndkOptions.push(opts);
    return {
      pool: { on: vi.fn(), relays: new Map(), getRelay: poolGetRelay },
      outboxPool: { relays: new Map(), getRelay: outboxGetRelay },
      connect: vi.fn().mockResolvedValue(undefined),
      signer: undefined,
      subscribe: vi.fn(),
      fetchEvents: vi.fn().mockResolvedValue(new Set()),
    };
  });

  return {
    default: MockNDK,
    NDKUser: vi.fn(),
    NDKEvent: vi.fn(),
    NDKRelaySet: { fromRelayUrls: vi.fn((urls: string[]) => ({ relays: new Set(urls), urls })) },
  };
});

beforeEach(() => {
  ndkOptions.length = 0;
  poolGetRelay.mockClear();
  outboxGetRelay.mockClear();
});

const lastOptions = () => ndkOptions[ndkOptions.length - 1];

describe('outbox lookup pool', () => {
  it('asks OUR relay for relay lists, not only the public indexers', () => {
    // The assertion the whole bug reduces to. Omitting outboxRelayUrls is not a
    // missing nicety, it silently routes the lookup to relays that cannot have
    // the answer for our own users.
    new NdkService({ explicitRelayUrls: ['wss://relay.cloistr.xyz'], autoConnect: false });

    expect(lastOptions().outboxRelayUrls).toEqual(
      expect.arrayContaining(['wss://relay.cloistr.xyz'])
    );
  });

  it('KEEPS the public indexers alongside ours', () => {
    // A user arriving with an existing Nostr identity already indexed on
    // purplepag.es resolves from there today, and that path must not regress.
    // Replacing the defaults instead of extending them would trade one broken
    // half for the other, which is why this is a separate test.
    new NdkService({ explicitRelayUrls: ['wss://relay.cloistr.xyz'], autoConnect: false });

    expect(lastOptions().outboxRelayUrls).toEqual(
      expect.arrayContaining(['wss://purplepag.es/', 'wss://nos.lol/'])
    );
  });

  it('carries every configured relay into the lookup pool, not just the first', () => {
    new NdkService({
      explicitRelayUrls: ['wss://relay.cloistr.xyz', 'wss://relay.example'],
      autoConnect: false,
    });

    expect(lastOptions().outboxRelayUrls).toEqual(
      expect.arrayContaining(['wss://relay.cloistr.xyz', 'wss://relay.example'])
    );
  });
});

describe('setConfiguredRelays reaches NDK', () => {
  it('adds resolved relays to the MAIN pool permanently', () => {
    // permanentAndConnectedRelays() is NDK's fallback when a lookup yields
    // nothing, and it excludes temporary relays by name -- temporary being what
    // NDKRelaySet.fromRelayUrls creates. So a relay that is only ever read from
    // can never receive a write. Permanent is the load-bearing word.
    const service = new NdkService({
      explicitRelayUrls: ['wss://relay.cloistr.xyz'],
      autoConnect: false,
    });
    poolGetRelay.mockClear();

    service.setConfiguredRelays(['wss://relay.cloistr.xyz', 'wss://relay.damus.io']);

    expect(poolGetRelay).toHaveBeenCalledWith('wss://relay.damus.io', true, false);
  });

  it('adds resolved relays to the OUTBOX pool too', () => {
    // Otherwise a user who moves their relay list somewhere new has it written
    // to a relay the resolver never asks, which is this bug again one edit later.
    const service = new NdkService({
      explicitRelayUrls: ['wss://relay.cloistr.xyz'],
      autoConnect: false,
    });
    outboxGetRelay.mockClear();

    service.setConfiguredRelays(['wss://relay.damus.io']);

    expect(outboxGetRelay).toHaveBeenCalledWith('wss://relay.damus.io', true, false);
  });

  it('adds them as PERMANENT, never temporary', () => {
    // Stated as its own test because getRelay's third argument is what decides
    // it, and a temporary relay is invisible to permanentAndConnectedRelays --
    // the exact silent narrowing this fix exists to end.
    const service = new NdkService({ explicitRelayUrls: [], autoConnect: false });
    poolGetRelay.mockClear();

    service.setConfiguredRelays(['wss://relay.damus.io']);

    for (const call of poolGetRelay.mock.calls) {
      expect(call[2]).toBe(false);
    }
    expect(poolGetRelay).toHaveBeenCalled();
  });
});
