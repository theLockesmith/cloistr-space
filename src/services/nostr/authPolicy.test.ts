/**
 * @fileoverview Tests for the NIP-42 relay auth policy.
 *
 * The policy decides when Space hands a relay a signed kind:22242. Getting it
 * wrong is not a cosmetic failure: too permissive re-creates the auth storm and
 * pubkey disclosure that made the old blanket policy unsafe once outbox was on,
 * too strict silently empties the user's own DM inbox. Both directions are
 * covered here.
 */

import { describe, it, expect } from 'vitest';
import type { NDKRelay } from '@nostr-dev-kit/ndk';
import { RelayAuthPolicy } from './authPolicy';

/**
 * Minimal NDKRelay stand-in. The policy only reads `url` and
 * `subs.subscriptions.size`.
 */
function fakeRelay(url: string, subscriptionCount = 0): NDKRelay {
  return {
    url,
    subs: {
      subscriptions: new Map(
        Array.from({ length: subscriptionCount }, (_, i) => [`fingerprint-${i}`, []])
      ),
    },
  } as unknown as NDKRelay;
}

/** A relay whose subs getter throws, standing in for an NDK internals change. */
function hostileRelay(url: string): NDKRelay {
  return {
    url,
    get subs(): never {
      throw new Error('NDK internals changed');
    },
  } as unknown as NDKRelay;
}

const OWN = 'wss://relay.cloistr.xyz';
const STRANGER = 'wss://relay.damus.io';

describe('RelayAuthPolicy', () => {
  describe('tier 1 - relays the user chose', () => {
    it('authenticates to a trusted relay with no active subscriptions', async () => {
      const policy = new RelayAuthPolicy([OWN]);
      // No subscriptions: a tier 2/3 relay would be declined here. Tier 1 is not,
      // because the user's own relay needs auth before it will accept writes.
      await expect(policy.policy(fakeRelay(OWN, 0), 'challenge')).resolves.toBe(true);
    });

    it('authenticates to a trusted relay even when auth is disabled', async () => {
      const policy = new RelayAuthPolicy([OWN], false);
      // Turning the setting off means "tier 1 only", not "tier 1 as well".
      // Declining here would stop the user's own kind:10050 inbox serving DMs.
      await expect(policy.policy(fakeRelay(OWN, 0), 'challenge')).resolves.toBe(true);
    });

    it('treats trailing-slash variants as the same relay', async () => {
      const policy = new RelayAuthPolicy([OWN]);
      // NDK normalizes relay URLs with a trailing slash internally, so the
      // relay handed to the policy will not string-match what we configured.
      await expect(policy.policy(fakeRelay(`${OWN}/`, 0), 'challenge')).resolves.toBe(true);
    });

    it('is case-insensitive on the host', async () => {
      const policy = new RelayAuthPolicy(['wss://Relay.Cloistr.XYZ']);
      await expect(policy.policy(fakeRelay(OWN, 0), 'challenge')).resolves.toBe(true);
    });
  });

  describe('tiers 2 and 3 - relays reached via outbox or a hint', () => {
    it('declines an untrusted relay with no active subscriptions', async () => {
      const policy = new RelayAuthPolicy([OWN]);
      // This is the case that matters for feed latency. Outbox opens many
      // sockets; signing for the idle ones costs a NIP-46 round trip each.
      await expect(policy.policy(fakeRelay(STRANGER, 0), 'challenge')).resolves.toBe(false);
    });

    it('authenticates to an untrusted relay that has an active subscription', async () => {
      const policy = new RelayAuthPolicy([OWN]);
      // We are actually reading from this relay, so auth is the price of the
      // content the user asked for.
      await expect(policy.policy(fakeRelay(STRANGER, 1), 'challenge')).resolves.toBe(true);
    });

    it('declines every untrusted relay when auth is disabled, subscriptions or not', async () => {
      const policy = new RelayAuthPolicy([OWN], false);
      await expect(policy.policy(fakeRelay(STRANGER, 5), 'challenge')).resolves.toBe(false);
    });
  });

  describe('mutation after construction', () => {
    it('setTrustedRelays replaces the set rather than adding to it', async () => {
      const policy = new RelayAuthPolicy([OWN]);
      policy.setTrustedRelays([STRANGER]);

      // The old relay must lose tier 1 status. Relay preferences follow the
      // signing pubkey, so a key switch has to fully drop the previous key's set
      // rather than accumulate both.
      await expect(policy.policy(fakeRelay(OWN, 0), 'challenge')).resolves.toBe(false);
      await expect(policy.policy(fakeRelay(STRANGER, 0), 'challenge')).resolves.toBe(true);
    });

    it('addTrustedRelay extends the set without clearing it', async () => {
      const policy = new RelayAuthPolicy([OWN]);
      policy.addTrustedRelay('wss://groups.example.com');

      await expect(policy.policy(fakeRelay(OWN, 0), 'challenge')).resolves.toBe(true);
      await expect(
        policy.policy(fakeRelay('wss://groups.example.com', 0), 'challenge')
      ).resolves.toBe(true);
    });

    it('setEnabled toggles tier 2 and 3 without touching tier 1', async () => {
      const policy = new RelayAuthPolicy([OWN]);
      const busyStranger = fakeRelay(STRANGER, 1);

      await expect(policy.policy(busyStranger, 'challenge')).resolves.toBe(true);

      policy.setEnabled(false);
      await expect(policy.policy(busyStranger, 'challenge')).resolves.toBe(false);
      await expect(policy.policy(fakeRelay(OWN, 0), 'challenge')).resolves.toBe(true);

      policy.setEnabled(true);
      await expect(policy.policy(busyStranger, 'challenge')).resolves.toBe(true);
    });

    it('reports its state', () => {
      const policy = new RelayAuthPolicy([OWN], false);
      const state = policy.getState();

      expect(state.enabled).toBe(false);
      expect(state.trusted).toHaveLength(1);
      expect(state.trusted[0]).toContain('relay.cloistr.xyz');
    });
  });

  describe('hostile input', () => {
    it('does not throw on a malformed relay URL', async () => {
      const policy = new RelayAuthPolicy([OWN]);
      // Discovered URLs come from other users' relay lists and are not
      // guaranteed to be well-formed. NDK's normalizeRelayUrl throws on these.
      await expect(policy.policy(fakeRelay('not a url', 0), 'challenge')).resolves.toBe(false);
    });

    it('does not throw when a configured relay URL is malformed', async () => {
      const policy = new RelayAuthPolicy(['also not a url', OWN]);
      await expect(policy.policy(fakeRelay(OWN, 0), 'challenge')).resolves.toBe(true);
    });

    it('declines rather than throwing when the subscription manager is unreadable', async () => {
      const policy = new RelayAuthPolicy([OWN]);
      // Fail closed: an NDK internals change should cost content, not crash the
      // connection path.
      await expect(policy.policy(hostileRelay(STRANGER), 'challenge')).resolves.toBe(false);
    });

    it('still authenticates a trusted relay whose subscription manager is unreadable', async () => {
      const policy = new RelayAuthPolicy([STRANGER]);
      // Tier 1 is decided before subs is ever read.
      await expect(policy.policy(hostileRelay(STRANGER), 'challenge')).resolves.toBe(true);
    });
  });
});
