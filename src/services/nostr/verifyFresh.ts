/**
 * @fileoverview Verify a Nostr event's id and signature without trusting any
 * verdict cached on the object.
 *
 * nostr-tools' verifyEvent stores its result on the event under a symbol and
 * returns it on the next call. An object spread copies symbol-keyed
 * properties, so `{ ...verified, content: forged }` passes verifyEvent
 * unchecked. Rebuilding the event from its fields drops the cache.
 *
 * The only place in src allowed to call verifyEvent (verifyFresh.test.ts
 * enforces it). Mirrors @cloistr/threads' verifyFresh; use that once Space
 * depends on the package.
 */

import { verifyEvent, type Event } from 'nostr-tools';

export function verifyFresh(event: Event): boolean {
  return verifyEvent({
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags.map((t) => [...t]),
    content: event.content,
    sig: event.sig,
  });
}
