/**
 * The kit's one-tap gate requests, and the operator's signed "yes" to them.
 *
 * When a kit gate (the merge gate, for now) blocks and only the operator can let
 * a change through, the kit posts a REQUEST on a thread: a kind 1111 event,
 * attached to the fleet envelope as `grant_request`, whose tags name the gate,
 * repo, target branch and exact diff hash (kit: hooks/lib/grant_request.py).
 *
 * The answer the kit accepts is a complete event signed by an operator key --
 * kind 1111, content "yes", an `e` tag naming the request -- carried as the
 * WHOLE decrypted text of a thread message. The kit's reader parses that text
 * as an event; an envelope around it would hide it. A plain "yes" typed into
 * the composer can never pass, because a wrap is signed by a one-time key and
 * its author field is an unsigned claim.
 *
 * The request itself is signed by a one-time key, so nothing rests on who sent
 * it. What matters is that the text the operator reads is the text the
 * request's id covers: the yes signs that id, and the id is the hash of the
 * request's content and tags, diff hash included. So a request whose id does
 * not recompute is dropped rather than shown.
 */

import { verifyEvent, getEventHash, type Event, type UnsignedEvent } from 'nostr-tools';
import { wrapThreadMessageWithKey, type SignedWrap } from './giftWrap';

export const GATE_REQUEST_KIND = 1111;
const REQUEST_TAG = 'arbiter-grant-request';

export interface GateRequest {
  /** The request's event id: what the yes names, and so what it approves. */
  id: string;
  gate: string;
  repo: string;
  target: string;
  diff: string;
  /** The request's own signed text, written by the kit for the operator. */
  text: string;
}

/** The signer this needs: the signed-in user's NIP-07/NIP-46 signer. */
export interface GateYesSigner {
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedEvent): Promise<Event>;
}

const EVENT_FIELDS = ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'] as const;

/** A complete, correctly signed event with every field the kit checks; else null. */
function asSignedEvent(value: unknown): Event | null {
  if (!value || typeof value !== 'object') return null;
  const ev = value as Record<string, unknown>;
  if (!EVENT_FIELDS.every((f) => f in ev)) return null;
  if (!Array.isArray(ev.tags) || !ev.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'))) {
    return null;
  }
  // A clean copy of the seven fields, never the object handed in: nostr-tools
  // caches a passed check on the event under a symbol, object spread copies
  // that symbol, and verifyEvent then trusts it -- an event with its sig
  // swapped after signing passed as verified until this copy was made.
  const plain = Object.fromEntries(EVENT_FIELDS.map((f) => [f, ev[f]])) as unknown as Event;
  try {
    // verifyEvent recomputes the id from the fields, then checks the signature.
    return verifyEvent(plain) ? plain : null;
  } catch {
    return null;
  }
}

function firstTag(ev: Event, name: string): string | null {
  const t = ev.tags.find((tag) => tag[0] === name && tag.length >= 2);
  return t ? t[1] : null;
}

/** A kit gate request whose id covers what it says; null for anything else. */
export function parseGateRequest(value: unknown): GateRequest | null {
  const ev = asSignedEvent(value);
  if (!ev || ev.kind !== GATE_REQUEST_KIND || firstTag(ev, 't') !== REQUEST_TAG) return null;
  const gate = firstTag(ev, 'gate');
  const repo = firstTag(ev, 'repo');
  const target = firstTag(ev, 'target');
  const diff = firstTag(ev, 'diff');
  if (!gate || !repo || !target || !diff) return null;
  return { id: ev.id, gate, repo, target, diff, text: ev.content };
}

/**
 * A message whose whole text is a signed yes: who signed it, and which request
 * it answers. Null for anything else, including a "yes" nobody signed.
 */
export function parseGateYes(plaintext: string): { requestId: string; signer: string } | null {
  if (!plaintext.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  const ev = asSignedEvent(parsed);
  if (!ev || ev.kind !== GATE_REQUEST_KIND || ev.content !== 'yes') return null;
  const requestId = firstTag(ev, 'e');
  return requestId ? { requestId, signer: ev.pubkey } : null;
}

/**
 * Have the user's own signer sign "yes" to a request, and check what comes
 * back: a remote signer is another program, and a yes that would not verify,
 * or that is signed as someone else, or that says something else, is caught
 * here rather than left for the kit to silently ignore.
 */
export async function signGateYes(signer: GateYesSigner, requestId: string, nowSec?: number): Promise<Event> {
  const pubkey = await signer.getPublicKey();
  const unsigned: UnsignedEvent = {
    kind: GATE_REQUEST_KIND,
    content: 'yes',
    tags: [['e', requestId]],
    created_at: nowSec ?? Math.floor(Date.now() / 1000),
    pubkey,
  };
  const signed = await signer.signEvent(unsigned);
  if (!asSignedEvent(signed)) throw new Error('Your signer returned a reply that does not verify.');
  if (signed.pubkey !== pubkey) throw new Error('Your signer signed as a different key than the one signed in.');
  if (signed.id !== getEventHash(unsigned)) throw new Error('Your signer changed the reply before signing it.');
  return signed;
}

/** The thread message carrying a signed yes: the event, and nothing else, as its text. */
export function wrapGateYes(yes: Event, threadSecretHex: string, nowSec?: number): SignedWrap {
  const text = JSON.stringify(Object.fromEntries(EVENT_FIELDS.map((f) => [f, yes[f]])));
  return wrapThreadMessageWithKey(text, yes.pubkey, threadSecretHex, nowSec);
}
