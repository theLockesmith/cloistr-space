/**
 * @fileoverview Resolve the signed-in user's own relays and apply them.
 *
 * Space shipped with a hardcoded default relay and never consulted the user's
 * relay preferences at all. NdkService.setConfiguredRelays existed with a
 * comment describing exactly this step, and had zero call sites -- so the
 * kind:10002 editor in the Profile section let a user curate a relay list that
 * nothing in the app then read.
 *
 * Resolution itself is @cloistr/collab-common's, not reimplemented here. It
 * mirrors cloistr-common/relayprefs (Go) and is the same chain every other
 * Cloistr service uses: discovery service, then kind:30078 d=cloistr-relays,
 * then NIP-65 kind:10002, then the configured default. Hand-rolling it here
 * would give Space a private notion of "the user's relays" that disagrees with
 * Stash, Vault, Calendar and Email.
 */

import { getRelayPrefs, type RelayPrefs } from '@cloistr/collab-common/relay';
import type { Event as NostrEvent, Filter as NostrFilter } from 'nostr-tools';
import type { NdkService } from './ndk';
import { config, defaultRelays } from '@/config/environment';

/**
 * Adapt NdkService.subscribe to the pool shape getRelayPrefs expects.
 *
 * collab-common is written against nostr-tools, Space runs NDK. Without this
 * the resolver silently loses its two direct-query steps and can only answer
 * from the discovery service or the default -- which would miss a kind:10002 a
 * user had just published from the Profile page, the exact case this is for.
 */
function ndkPoolAdapter(service: NdkService) {
  return {
    subscribe(
      filters: NostrFilter[],
      onEvent: (event: NostrEvent) => void,
      options?: { oneose?: () => void }
    ) {
      const sub = service.subscribe(filters as never, { closeOnEose: true });

      sub.on('event', (event: { rawEvent: () => unknown }) => {
        onEvent(event.rawEvent() as NostrEvent);
      });

      if (options?.oneose) {
        sub.on('eose', options.oneose);
      }

      sub.start();

      return { close: () => sub.stop() };
    },
  };
}

export interface ResolveResult {
  prefs: RelayPrefs;
  /** Relays handed to NdkService: the union of read and write. */
  applied: string[];
}

/**
 * Resolve the user's relays and apply them to the NDK service.
 *
 * The union of read and write relays is applied rather than one or the other.
 * configuredRelays drives two things with different needs -- which relays the
 * pool holds, and which relays are tier 1 for NIP-42 auth -- and a write-only
 * relay still has to be authenticated to accept a publish while a read-only one
 * still has to be authenticated to serve a restricted feed. Splitting them here
 * would mean one of those two silently missing half the set.
 */
export async function resolveAndApplyRelays(
  service: NdkService,
  pubkey: string
): Promise<ResolveResult> {
  const prefs = await getRelayPrefs(
    pubkey,
    {
      discoveryUrl: config.discoveryApiUrl.replace(/\/api\/?$/, ''),
      defaultRelay: defaultRelays[0],
    },
    ndkPoolAdapter(service)
  );

  const applied = [...new Set([...prefs.readRelays, ...prefs.writeRelays])].filter(Boolean);

  // Never end up with an empty pool. A resolver that returns nothing would
  // otherwise disconnect the user from everything, which is worse than the
  // default they started with.
  const finalRelays = applied.length > 0 ? applied : [...defaultRelays];

  service.setConfiguredRelays(finalRelays);

  return { prefs, applied: finalRelays };
}
