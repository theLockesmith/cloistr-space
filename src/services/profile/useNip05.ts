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
 *
 * LOADING is derived, not stored. The hook returns null when the current
 * inputs have no settled result yet, so the caller never sees a stale
 * state from a previous profile while a new fetch is in flight.
 */

import { useEffect, useState } from 'react';

export type Nip05State = 'verified' | 'unverified' | 'unknown';

/** Shape of a well-known nostr.json response. Open-ended by spec. */
interface WellKnownResponse {
  names?: Record<string, string>;
}

/** A settled verification result, tagged with the inputs that produced it. */
interface Nip05Result {
  nip05: string;
  pubkey: string;
  state: Nip05State;
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
  const [result, setResult] = useState<Nip05Result | null>(null);

  useEffect(() => {
    // No inputs: nothing to fetch, no state to set. The null return is
    // derived at the bottom of the hook rather than stored here -- a
    // synchronous setState in an effect body causes cascading renders.
    if (!nip05 || !pubkey) return;

    // active guards against setResult firing after cleanup (unmount or
    // deps change). AbortController handles the fetch itself; active
    // handles the Promise.resolve() microtask for the !parsed path.
    let active = true;
    const controller = new AbortController();

    const capturedNip05 = nip05;
    const capturedPubkey = pubkey;

    const resolve = (state: Nip05State) => {
      if (!active) return;
      setResult({ nip05: capturedNip05, pubkey: capturedPubkey, state });
    };

    const parsed = parseNip05(nip05);
    if (!parsed) {
      // Unparseable address: the answer is known synchronously, but we must
      // not call setState synchronously in an effect body. Schedule it on
      // the next microtask instead.
      void Promise.resolve().then(() => resolve('unknown'));
      return () => {
        active = false;
      };
    }

    const { local, domain } = parsed;
    const url =
      'https://' + domain + '/.well-known/nostr.json' + '?name=' + encodeURIComponent(local);

    fetch(url, {
      signal: controller.signal,
      referrerPolicy: 'no-referrer',
      // CORS: the well-known endpoint must serve Access-Control-Allow-Origin: *
      // per NIP-05. If it does not, fetch throws a network error which is
      // surfaced as UNKNOWN rather than UNVERIFIED.
      mode: 'cors',
    })
      .then(async (res) => {
        if (!res.ok) { resolve('unknown'); return; }

        let body: unknown;
        try {
          body = await res.json();
        } catch {
          resolve('unknown');
          return;
        }

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          resolve('unknown');
          return;
        }

        const { names } = body as WellKnownResponse;
        if (!names || typeof names !== 'object') { resolve('unknown'); return; }

        // Local-part comparison is case-insensitive per NIP-05.
        const localLower = local.toLowerCase();
        const returnedPubkey = Object.entries(names).find(
          ([k]) => k.toLowerCase() === localLower
        )?.[1];

        if (!returnedPubkey) { resolve('unverified'); return; }

        // Hex pubkey comparison is case-insensitive.
        resolve(
          returnedPubkey.toLowerCase() === capturedPubkey.toLowerCase()
            ? 'verified'
            : 'unverified'
        );
      })
      .catch((err: unknown) => {
        // AbortError is a clean cancel triggered by the cleanup below.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        resolve('unknown');
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [nip05, pubkey]);

  // Derive the null (loading/absent) case rather than storing it.
  // This also discards results that arrived for a previous nip05 or pubkey.
  if (!nip05 || !pubkey) return null;
  if (!result || result.nip05 !== nip05 || result.pubkey !== pubkey) return null;
  return result.state;
}
