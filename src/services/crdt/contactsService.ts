/**
 * Pure NIP-0A contact list operations, callable without React.
 *
 * Takes a SignerInterface and a RelayClient like the other pure modules, so a
 * headless caller holding its own key follows and unfollows through the same
 * code the UI uses.
 *
 * kind:33000 is ADDRESSABLE on d=contacts: a publish replaces the whole list.
 * So every edit reads first, and the read has three outcomes, not two:
 *
 *   failed      publish nothing
 *   no list     publish only if the caller explicitly asked to create one
 *   a list      merge the change in, publish the whole list
 *
 * "No list" gets its own rule because a relay that did not answer looks the
 * same as a user with no list, and a one-entry publish over a real list is
 * exactly how the operator's follow list was wiped on 2026-08-24.
 */

import { signAndPublish, type SignerInterface, type RelayClient, type PublishOutcome } from '../headless';
import type { ContactEntry, ContactsCrdtState } from '@/types/contacts';
import {
  NIP0A_KIND,
  buildNip0aContent,
  buildNip0aTags,
  getNip0aFilter,
  mergeNip0aEvents,
} from './nip0a';

export type ContactsRead =
  | { ok: false }
  | { ok: true; found: false }
  | { ok: true; found: true; state: ContactsCrdtState };

export type ContactEditResult =
  | { ok: true; outcome: PublishOutcome }
  | { ok: false; reason: 'read-failed' | 'no-list' };

/**
 * Read and merge the user's contact lists from the relay.
 *
 * Only events signed by `pubkey` count: a list anyone else published under the
 * same filter would otherwise be merged in and republished under our name.
 */
export async function readContacts(relay: RelayClient, pubkey: string): Promise<ContactsRead> {
  let events;
  try {
    events = await relay.fetch(getNip0aFilter(pubkey));
  } catch {
    return { ok: false };
  }
  const own = events.filter((e) => e.kind === NIP0A_KIND && e.pubkey === pubkey);
  if (own.length === 0) return { ok: true, found: false };
  return { ok: true, found: true, state: mergeNip0aEvents(own) };
}

/**
 * Publish a whole contact list. Returns null, publishing nothing, when the list
 * has no entries: the d tag is always present, so "no tags" is the wrong test.
 */
export async function publishContactState(
  signer: SignerInterface,
  relay: RelayClient,
  state: ContactsCrdtState,
): Promise<PublishOutcome | null> {
  const tags = buildNip0aTags(state);
  if (!tags.some((t) => t[0] === 'p' || t[0] === 'np')) return null;
  return signAndPublish(signer, relay, {
    kind: NIP0A_KIND,
    content: buildNip0aContent(state),
    tags,
  });
}

function emptyState(): ContactsCrdtState {
  return { entries: new Map(), version: 0, lastSync: 0, clientId: 'headless', pendingChanges: [] };
}

/** Later than now and than whatever it replaces, so the change wins LWW. */
function stampAfter(existing?: ContactEntry): number {
  const now = Math.floor(Date.now() / 1000);
  return existing ? Math.max(now, existing.timestamp + 1) : now;
}

async function editContacts(
  signer: SignerInterface,
  relay: RelayClient,
  ownerPubkey: string,
  createIfMissing: boolean,
  edit: (state: ContactsCrdtState) => void,
): Promise<ContactEditResult> {
  const read = await readContacts(relay, ownerPubkey);
  if (!read.ok) return { ok: false, reason: 'read-failed' };
  if (!read.found && !createIfMissing) return { ok: false, reason: 'no-list' };

  const state = read.found ? read.state : emptyState();
  edit(state);

  const outcome = await publishContactState(signer, relay, state);
  // Unreachable after an edit adds an entry; kept so the type stays honest.
  if (!outcome) return { ok: false, reason: 'no-list' };
  return { ok: true, outcome };
}

export interface FollowOptions {
  relay?: string;
  petname?: string;
  /** Publish a new list when none is found. Off by default; see module doc. */
  createIfMissing?: boolean;
}

export function followContact(
  signer: SignerInterface,
  relay: RelayClient,
  ownerPubkey: string,
  target: string,
  options: FollowOptions = {},
): Promise<ContactEditResult> {
  return editContacts(signer, relay, ownerPubkey, options.createIfMissing ?? false, (state) => {
    state.entries.set(target, {
      pubkey: target,
      relay: options.relay,
      petname: options.petname,
      timestamp: stampAfter(state.entries.get(target)),
      deleted: false,
    });
  });
}

export function unfollowContact(
  signer: SignerInterface,
  relay: RelayClient,
  ownerPubkey: string,
  target: string,
): Promise<ContactEditResult> {
  return editContacts(signer, relay, ownerPubkey, false, (state) => {
    state.entries.set(target, {
      pubkey: target,
      timestamp: stampAfter(state.entries.get(target)),
      deleted: true,
    });
  });
}
