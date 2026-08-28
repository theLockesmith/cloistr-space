/**
 * @fileoverview NIP-42 relay authentication policy.
 *
 * Replaces the blanket `async () => true` that shipped in 7ef5e6f. That policy was
 * written in the same commit that reduced the pool to a single relay
 * (relay.cloistr.xyz), so at the time "auth to everything" and "auth to my own
 * relay" were the same statement. Enabling the outbox model puts arbitrary
 * third-party relays back in the pool, which invalidates that assumption.
 *
 * Two costs of authenticating indiscriminately, in order of how much they matter:
 *
 * 1. LATENCY. Every AUTH is a NIP-46 round trip to the remote signer, and Cloistr
 *    services auto-approve those, so nothing throttles them. Under outbox NDK
 *    connects to many relays at once; authenticating to all of them produces a
 *    burst of signature requests exactly while the user waits on an empty feed.
 * 2. DISCLOSURE. A kind:22242 event ties the user's pubkey to a read-only
 *    connection. Mostly benign -- the follow list is public, so "X reads Alice"
 *    is already inferable -- but it does make presence and timing attributable.
 *
 * The design that addresses both without ever prompting the user is in coord task
 * fc863561. Its three tiers are a classification of RELAYS, not user-selectable
 * modes; all are live simultaneously.
 */

import type { NDKAuthPolicy, NDKRelay } from '@nostr-dev-kit/ndk';
import { normalizeRelayUrl } from '@nostr-dev-kit/ndk';

/**
 * Normalize a relay URL for set membership.
 *
 * Two things to be careful about, both load-bearing:
 *
 * NDK's normalizeRelayUrl is used for its protocol/port/query handling, but it
 * cannot be relied on to fold case. Its underlying normalizeUrl only treats
 * http/https/file as known protocols, so `wss:` takes a custom-protocol path
 * that preserves the original casing. Relay hosts are DNS names and therefore
 * case-insensitive, so `wss://Relay.Cloistr.XYZ` and `wss://relay.cloistr.xyz`
 * are the same relay -- and a tier 1 miss here would mean declining auth to the
 * user's OWN relay, which reads as an empty DM inbox rather than as an error.
 * Hence the explicit host-lowercasing pass. Paths are left alone: they are not
 * guaranteed case-insensitive.
 *
 * It also throws on malformed input rather than returning a fallback, and this
 * runs on URLs discovered from other users' relay lists -- data we do not
 * control. A throw inside the auth policy would decline a relay for the wrong
 * reason and be painful to trace, so every step degrades instead.
 */
function normalize(url: string): string {
  const trimmed = url.trim();

  let candidate = trimmed;
  try {
    candidate = normalizeRelayUrl(trimmed);
  } catch {
    // Keep the trimmed original and let the URL pass below do what it can.
  }

  try {
    const parsed = new URL(candidate);
    parsed.hostname = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
  } catch {
    return candidate.replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * True when the relay currently has at least one open subscription.
 *
 * This is what makes auth demand-driven: a relay we are merely connected to but
 * not reading from gets no signature. `subs.subscriptions` is a public field on
 * NDKRelaySubscriptionManager (NDK 2.18.1).
 *
 * It is a snapshot, so it races against subscriptions opening. A relay that
 * challenges before its first REQ lands is declined; NDK retries auth on the
 * next challenge, so the cost is a delay rather than lost content. Preferring
 * that over authenticating to everything on connect is the entire point.
 */
function hasActiveSubscriptions(relay: NDKRelay): boolean {
  try {
    return relay.subs.subscriptions.size > 0;
  } catch {
    // Never let an NDK internals change turn into an auth failure.
    return false;
  }
}

export interface RelayAuthPolicyState {
  /** Relays the user chose. Always authenticated. */
  trusted: string[];
  /** Whether to authenticate beyond the trusted set. */
  enabled: boolean;
}

/**
 * Tiered NIP-42 policy.
 *
 * TIER 1 -- relays the user chose: their own read/write relays (kind:30078
 * cloistr-relays, kind:10002), their DM inbox (kind:10050), Cloistr-operated
 * relays, and NIP-29 groups they joined. Always authenticated, and deliberately
 * exempt from the user setting: declining here would stop the user's own DM inbox
 * from serving their DMs and stop their own relay from accepting their writes.
 * Tier 1 is the floor, not an upgrade.
 *
 * TIERS 2 AND 3 -- everything else, reached by outbox routing or by following a
 * relay hint: authenticated only while the relay has an open subscription.
 *
 * fc863561 separates tier 2 (write relays of followed authors) from tier 3 (hints,
 * quotes, thread parents, profile browse) by auth timing, and explicitly allows
 * collapsing them if the split proves ugly. It does: NDKAuthPolicy receives only
 * (relay, challenge) with no subscription context, so "which tier is this relay"
 * is not answerable at the callback. Both tiers reduce to the same rule anyway --
 * authenticate when something is actually being read -- so they are one branch
 * here. The behaviour fc863561 wanted is preserved; only the taxonomy is flatter.
 */
export class RelayAuthPolicy {
  private trusted = new Set<string>();
  private enabled = true;

  constructor(trustedRelays: Iterable<string> = [], enabled = true) {
    this.setTrustedRelays(trustedRelays);
    this.enabled = enabled;
  }

  /**
   * Replace the tier 1 set. Call on login and whenever the active key changes --
   * relay preferences follow the signing pubkey, so a key switch invalidates them.
   */
  setTrustedRelays(urls: Iterable<string>): void {
    this.trusted = new Set([...urls].map(normalize));
  }

  /** Add to tier 1 without replacing it, e.g. when joining a NIP-29 group. */
  addTrustedRelay(url: string): void {
    this.trusted.add(normalize(url));
  }

  /**
   * Toggle authentication beyond tier 1.
   *
   * Backs a single user-facing setting that defaults to on (see ded5c8fc).
   * Off means tier 1 only: the user stays unauthenticated to relays they did not
   * choose and accepts a sparser feed in exchange.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Current state, for display and debugging. */
  getState(): RelayAuthPolicyState {
    return { trusted: [...this.trusted], enabled: this.enabled };
  }

  /**
   * The NDKAuthPolicy callback.
   *
   * Returning true delegates to NDK's own sign-in, which builds and signs the
   * kind:22242. Returning false declines without disconnecting -- the relay stays
   * in the pool and still serves anything that does not require auth.
   */
  readonly policy: NDKAuthPolicy = async (relay: NDKRelay): Promise<boolean> => {
    const url = normalize(relay.url);

    if (this.trusted.has(url)) {
      return true;
    }

    if (!this.enabled) {
      return false;
    }

    return hasActiveSubscriptions(relay);
  };
}
