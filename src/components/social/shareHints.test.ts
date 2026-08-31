/**
 * @fileoverview Tests for which relays end up in a share link.
 *
 * A shared link's whole job is to resolve for someone who is NOT already on our
 * relay. Its hints therefore have to name relays that actually hold the event
 * and will keep holding it.
 */

import { describe, it, expect } from 'vitest';
import { ownRelayHints } from './ShareMenu';

const status = (url: string, configured: boolean, s = 'connected') =>
  [url, { url, configured, status: s }] as const;

describe('ownRelayHints', () => {
  it('includes the user\'s own relays', () => {
    const map = new Map([status('wss://relay.cloistr.xyz', true)]);

    expect(ownRelayHints(map)).toEqual(['wss://relay.cloistr.xyz']);
  });

  it('excludes relays the outbox model merely discovered', () => {
    // A hint pointing at a stranger's relay is noise, and if that relay drops
    // the event it is a link that quietly stops working for the recipient.
    const map = new Map([
      status('wss://relay.cloistr.xyz', true),
      status('wss://someone-elses.example', false),
    ]);

    expect(ownRelayHints(map)).toEqual(['wss://relay.cloistr.xyz']);
  });

  it('keeps a configured relay that is momentarily disconnected', () => {
    // Connected-ness is not a filter. A configured relay that is down right now
    // is still where the event lives, and filtering on it would make the
    // quality of a shared link depend on the sharer's connection at the instant
    // they pressed the button.
    const map = new Map([status('wss://relay.cloistr.xyz', true, 'disconnected')]);

    expect(ownRelayHints(map)).toEqual(['wss://relay.cloistr.xyz']);
  });

  it('returns nothing when no relay is configured', () => {
    // encodeEvent then falls back to a bare note1 rather than fabricating a
    // hint, which is honest: we genuinely do not know where it lives.
    const map = new Map([status('wss://discovered.example', false)]);

    expect(ownRelayHints(map)).toEqual([]);
  });
});
