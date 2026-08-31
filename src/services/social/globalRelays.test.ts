/**
 * @fileoverview Tests for the global feed's relay span.
 *
 * Operator: "My 'global' feed is emptier than my 'following' feed."
 *
 * CAUSE, in NDK's routing (dist/index.js:2652-2692):
 *
 *   filter WITH authors     -> those authors' write relays, via outbox (dozens)
 *   filter WITHOUT authors  -> ndk.explicitRelayUrls ONLY (for us, exactly one)
 *
 * following and wot carry `authors: following`. global carries none. So global
 * asked ONE relay while following asked dozens, making global a strict SUBSET
 * of following -- exactly inverted from what the word means.
 *
 * THE TRAP IN THE OBVIOUS FIX, which is what most of these tests are about: an
 * explicit relaySet skips that routing but also FREEZES the subscription, since
 * NDK's pool monitor recomputes from the filter and a no-authors filter
 * resolves right back to explicitRelayUrls. Pinning global would have silently
 * undone !86's late-relay fix for that mode, and would have surfaced months
 * later as "global sometimes misses posts" -- indistinguishable from ordinary
 * relay flakiness, with !86 the last place anyone would look.
 */

import { describe, it, expect } from 'vitest';
import { connectedRelayUrls, widenRelays, needsExplicitRelays } from './globalRelays';

const status = (url: string, s = 'connected') => ({ url, status: s });

describe('connectedRelayUrls', () => {
  it('takes only connected relays', () => {
    expect(
      connectedRelayUrls([status('wss://a'), status('wss://b', 'connecting'), status('wss://c')])
    ).toEqual(['wss://a', 'wss://c']);
  });

  it('sorts, so the result does not depend on map ordering', () => {
    expect(connectedRelayUrls([status('wss://z'), status('wss://a')])).toEqual([
      'wss://a',
      'wss://z',
    ]);
  });

  it('returns nothing when nothing is connected', () => {
    // The caller then passes no relaySet and falls back to NDK's routing, which
    // is worse but is not silence.
    expect(connectedRelayUrls([status('wss://a', 'disconnected')])).toEqual([]);
  });
});

describe('widenRelays', () => {
  it('returns the SAME array when nothing was added', () => {
    // toBe, not toEqual. This array is an effect dependency: an equal-but-new
    // array would re-subscribe the global feed on every relay status change,
    // which is a REQ storm rather than a fix.
    const prev = ['wss://a'];

    expect(widenRelays(prev, ['wss://a'])).toBe(prev);
  });

  it('grows when a new relay connects', () => {
    expect(widenRelays(['wss://a'], ['wss://a', 'wss://b'])).toEqual(['wss://a', 'wss://b']);
  });

  it('KEEPS a relay that has dropped', () => {
    // Monotonic on purpose. Keeping a lost relay costs nothing -- NDK simply
    // cannot reach it -- while removing it costs a re-subscribe, and a flapping
    // relay would then re-subscribe on every transition.
    const prev = ['wss://a', 'wss://b'];

    expect(widenRelays(prev, ['wss://a'])).toBe(prev);
  });

  it('does not churn on a relay flapping', () => {
    // The property that bounds re-subscribes to the number of DISTINCT relays
    // ever seen, rather than to connection events.
    let set = widenRelays([], ['wss://a', 'wss://b']);
    const afterFirst = set;

    set = widenRelays(set, ['wss://a']);
    set = widenRelays(set, ['wss://a', 'wss://b']);
    set = widenRelays(set, ['wss://b']);

    expect(set).toBe(afterFirst);
  });

  it('starts from empty', () => {
    expect(widenRelays([], ['wss://a'])).toEqual(['wss://a']);
  });

  it('stays sorted as it grows', () => {
    expect(widenRelays(['wss://b'], ['wss://a'])).toEqual(['wss://a', 'wss://b']);
  });
});

describe('needsExplicitRelays', () => {
  it('is true only for global', () => {
    expect(needsExplicitRelays('global')).toBe(true);
  });

  it('is FALSE for following and wot', () => {
    // Overriding routing for these would CONFINE them to relays we happen to be
    // connected to, rather than the ones their authors actually write to --
    // making the feeds that currently work worse in order to fix the one that
    // does not.
    expect(needsExplicitRelays('following')).toBe(false);
    expect(needsExplicitRelays('wot')).toBe(false);
  });
});
