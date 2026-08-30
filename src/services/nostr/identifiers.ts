/**
 * @fileoverview NIP-19 identifiers: shareable links in and out.
 *
 * A link someone pastes here from another client must open, and a link copied
 * from here must open in theirs. That is the whole job.
 *
 * WHY RELAY HINTS ARE NOT OPTIONAL. A bare `note1...` is just an event id. Any
 * client that is not already connected to a relay holding that event cannot
 * resolve it, so a share link without hints works only for people who did not
 * need it. `nevent` and `nprofile` carry relay hints; we emit those rather than
 * the bare forms for exactly that reason -- and it matters more for us than for
 * a big public client, because our events live on a relay nobody else is on by
 * default.
 *
 * WHY nsec IS REFUSED LOUDLY. This module decodes "whatever the user pasted",
 * and an nsec is a private key. Decoding one and quietly treating it as an
 * identifier -- or worse, putting it in a URL -- would be the single worst bug
 * in the app. It gets its own branch and its own error rather than falling into
 * a default case, because "unsupported type" is not the message someone needs
 * when they have just pasted their secret key into a box.
 */

import { nip19 } from 'nostr-tools';

/** A decoded reference to something we can display. */
export type Identifier =
  | { type: 'profile'; pubkey: string; relays: string[] }
  | { type: 'event'; id: string; relays: string[]; author?: string }
  | { type: 'address'; kind: number; pubkey: string; identifier: string; relays: string[] };

export class SecretKeyPastedError extends Error {
  constructor() {
    super(
      'That is a private key (nsec), not a link. Never paste it anywhere. ' +
        'If you pasted it somewhere else too, treat it as compromised.'
    );
    this.name = 'SecretKeyPastedError';
  }
}

const HEX_64 = /^[0-9a-f]{64}$/i;

/**
 * Decode anything a user might paste into a "go to" box or a route parameter.
 *
 * Accepts npub, note, nevent, nprofile, naddr, a bare 64-char hex id, and any
 * of those behind a `nostr:` URI prefix.
 *
 * Returns null for input we do not understand -- but THROWS for nsec, because
 * those are different situations and the caller must not treat them alike.
 */
export function decodeIdentifier(input: string): Identifier | null {
  const raw = input.trim().replace(/^nostr:/i, '');
  if (!raw) return null;

  // Checked before decoding so a malformed nsec still gets the right message.
  if (raw.toLowerCase().startsWith('nsec1')) {
    throw new SecretKeyPastedError();
  }

  // A bare hex string is ambiguous -- it could be a pubkey or an event id --
  // and nothing in the string says which. Callers that know the context
  // resolve it with decodeHexAs(); guessing here would be wrong half the time.
  if (HEX_64.test(raw)) return null;

  let decoded: nip19.DecodedResult;
  try {
    decoded = nip19.decode(raw);
  } catch {
    return null;
  }

  switch (decoded.type) {
    case 'npub':
      return { type: 'profile', pubkey: decoded.data, relays: [] };

    case 'nprofile':
      return {
        type: 'profile',
        pubkey: decoded.data.pubkey,
        relays: decoded.data.relays ?? [],
      };

    case 'note':
      return { type: 'event', id: decoded.data, relays: [] };

    case 'nevent':
      return {
        type: 'event',
        id: decoded.data.id,
        relays: decoded.data.relays ?? [],
        author: decoded.data.author,
      };

    case 'naddr':
      return {
        type: 'address',
        kind: decoded.data.kind,
        pubkey: decoded.data.pubkey,
        identifier: decoded.data.identifier,
        relays: decoded.data.relays ?? [],
      };

    case 'nsec':
      // Belt and braces: unreachable given the prefix check, and left in place
      // because the cost of this branch is nothing and the cost of the prefix
      // check being wrong is someone's key.
      throw new SecretKeyPastedError();

    default:
      return null;
  }
}

/**
 * Interpret a bare hex string whose meaning the caller knows from context.
 *
 * A route like /p/<hex> knows it holds a pubkey; /e/<hex> knows it holds an
 * event id. decodeIdentifier deliberately refuses to guess, so this is where
 * that knowledge gets applied.
 */
export function decodeHexAs(hex: string, as: 'profile' | 'event'): Identifier | null {
  if (!HEX_64.test(hex)) return null;
  const value = hex.toLowerCase();
  return as === 'profile'
    ? { type: 'profile', pubkey: value, relays: [] }
    : { type: 'event', id: value, relays: [] };
}

/** Relay hints are capped: a bech32 identifier grows with every one. */
const MAX_HINTS = 3;

function hints(relays: string[]): string[] {
  return relays.filter((r) => r.startsWith('ws')).slice(0, MAX_HINTS);
}

/**
 * Encode a profile for sharing.
 *
 * nprofile rather than npub whenever we have relays to name, so the link
 * resolves for someone who is not already on our relay.
 */
export function encodeProfile(pubkey: string, relays: string[] = []): string {
  const h = hints(relays);
  return h.length > 0 ? nip19.nprofileEncode({ pubkey, relays: h }) : nip19.npubEncode(pubkey);
}

/**
 * Encode an event for sharing.
 *
 * The author is included when known: it lets a receiving client use the outbox
 * model to find the event even if every relay hint is stale.
 */
export function encodeEvent(id: string, relays: string[] = [], author?: string): string {
  const h = hints(relays);
  if (h.length === 0 && !author) return nip19.noteEncode(id);
  return nip19.neventEncode({ id, relays: h, author });
}

/** In-app route for a profile. */
export function profilePath(pubkey: string, relays: string[] = []): string {
  return `/p/${encodeProfile(pubkey, relays)}`;
}

/** In-app route for a single note. */
export function notePath(id: string, relays: string[] = [], author?: string): string {
  return `/e/${encodeEvent(id, relays, author)}`;
}

/** Shortened form for display: `npub1abc…wxyz`. */
export function abbreviate(identifier: string, edge = 8): string {
  if (identifier.length <= edge * 2 + 1) return identifier;
  return `${identifier.slice(0, edge)}…${identifier.slice(-edge)}`;
}
