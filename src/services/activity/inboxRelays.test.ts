/**
 * Mentions are written to the recipient's read relays. Asking only our own
 * relay showed the operator none while the public relays held two from the
 * last week (live, 2026-10-16).
 */
import { describe, it, expect } from 'vitest';
import { inboxRelayUrls, MAX_INBOX_RELAYS } from './inboxRelays';

const OWN = ['wss://relay.cloistr.xyz'];

describe('inboxRelayUrls', () => {
  it("adds the user's read relays to ours", () => {
    const tags = [['r', 'wss://relay.damus.io'], ['r', 'wss://nos.lol', 'read']];
    expect(inboxRelayUrls(tags, OWN)).toEqual(['wss://relay.cloistr.xyz', 'wss://relay.damus.io', 'wss://nos.lol']);
  });

  it('leaves out write-only relays: nobody delivers mentions there', () => {
    expect(inboxRelayUrls([['r', 'wss://outbox.example', 'write']], OWN)).toEqual(OWN);
  });

  it('keeps our relays when the relay list could not be read', () => {
    expect(inboxRelayUrls(null, OWN)).toEqual(OWN);
  });

  it('deduplicates by normalized URL and caps the set', () => {
    const many = Array.from({ length: 20 }, (_, i) => ['r', `wss://r${i}.example`]);
    const urls = inboxRelayUrls([['r', 'wss://relay.cloistr.xyz/'], ...many], OWN);
    expect(urls[0]).toBe('wss://relay.cloistr.xyz');
    expect(urls.filter((u) => u.includes('cloistr'))).toHaveLength(1);
    expect(urls).toHaveLength(MAX_INBOX_RELAYS);
  });

  it('ignores entries that are not websocket URLs', () => {
    expect(inboxRelayUrls([['r', 'https://not-a-relay.example']], OWN)).toEqual(OWN);
  });
});
