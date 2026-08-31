/**
 * @fileoverview NIP-05 verification hook.
 *
 * THREE STATES, not two:
 *   VERIFIED   - well-known returned a pubkey that matches.
 *   UNVERIFIED - well-known returned a pubkey that does NOT match, or
 *                returned no entry for that name.
 *   UNKNOWN    - the request failed, timed out, address unparseable,
 *                or we cannot reach the domain.
 *
 * UNKNOWN must never be rendered as UNVERIFIED. We could not check and
 * this is not who they say are different claims. A network failure shown
 * as a verification failure defames the user whose relay was unreachable.
 */

import { useEffect, useState } from 'react';

export type Nip05State = 'verified' | 'unverified' | 'unknown';

/** Shape of a well-known nostr.json response. Open-ended by spec. */
interface WellKnownResponse {
  names?: Record<string, string>;
}

function parseNip05(identifier: string): { local: string; domain: string } | null {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  const at = trimmed.lastIndexOf('@');
  if (at === -1) return null;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!local || !domain) return null;

  return { local, domain };
}

export function useNip05(
  nip05: string | undefined,
  pubkey: string | undefined
): Nip05State | null {
  const [state, setState] = useState<Nip05State | null>(null);

  useEffect(() => {
    if (!nip05 || !pubkey) {
      setState(null);
      return;
    }

    const parsed = parseNip05(nip05);
    if (!parsed) {
      setState('unknown');
      return;
    }

    const { local, domain } = parsed;
    const controller = new AbortController();
    setState(null);

    const wkBase = domain;
    const url = 'https://' + wkBase + '/.well-known/nostr.json' + '?name=' + encodeURIComponent(local);

    fetch(url, {
      signal: controller.signal,
      referrerPolicy: 'no-referrer',
      mode: 'cors',
    })
      .then(async (res) => {
        if (!res.ok) {
          setState('unknown');
          return;
        }

        let body: unknown;
        try {
          body = await res.json();
        } catch {
          setState('unknown');
          return;
        }

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          setState('unknown');
          return;
        }

        const { names } = body as WellKnownResponse;
        if (!names || typeof names !== 'object') {
          setState('unknown');
          return;
        }

        const localLower = local.toLowerCase();
        const returnedPubkey = Object.entries(names).find(
          ([k]) => k.toLowerCase() === localLower
        )?.[1];

        if (!returnedPubkey) {
          setState('unverified');
          return;
        }

        if (returnedPubkey.toLowerCase() === pubkey.toLowerCase()) {
          setState('verified');
        } else {
          setState('unverified');
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState('unknown');
      });

    return () => {
      controller.abort();
    };
  }, [nip05, pubkey]);

  return state;
}
