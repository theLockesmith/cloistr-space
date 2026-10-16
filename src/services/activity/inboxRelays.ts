/**
 * @fileoverview Which relays to ask for things addressed TO the user.
 *
 * Mentions, replies, reactions and zaps are written to the recipient's READ
 * relays (NIP-65 "inbox"), declared in their kind:10002. A `#p` filter carries
 * no `authors`, so NDK routes it to explicitRelayUrls alone -- for us, one
 * relay. Space therefore asked only relay.cloistr.xyz, and anyone whose
 * mentions live on public relays saw none (operator's account, 2026-10-16:
 * 0 on our relay, 2 in the last week on their read relays).
 *
 * The set is our own relays plus the user's declared read relays.
 */

import { parseRelayListTags } from '@/services/profile/profileEvents';

/**
 * Cap on relays asked. A kind:10002 can list dozens; mentions need the inbox,
 * not the whole network, and each relay is a socket the page keeps open.
 */
export const MAX_INBOX_RELAYS = 8;

const normalize = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();

/**
 * Own relays first (they always count), then the user's read relays in the
 * order the list declares them, deduplicated and capped.
 *
 * @param relayListTags tags of the user's newest kind:10002, or null when it
 *        could not be read or does not exist
 */
export function inboxRelayUrls(relayListTags: string[][] | null, ownRelays: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (url: string) => {
    const key = normalize(url);
    if (!key.startsWith('wss://') && !key.startsWith('ws://')) return;
    if (seen.has(key) || out.length >= MAX_INBOX_RELAYS) return;
    seen.add(key);
    out.push(url.trim());
  };
  ownRelays.forEach(add);
  if (relayListTags) {
    for (const entry of parseRelayListTags(relayListTags)) {
      if (entry.read) add(entry.url);
    }
  }
  return out;
}
