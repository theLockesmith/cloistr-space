/**
 * @fileoverview Guards the undo path for reactions and reposts.
 *
 * Operator: "It seems I can no longer un-heart posts."
 *
 * It never worked. `if (!canAct || note.userReacted) return` made the control
 * inert once used, and that guard arrived in e14470c -- the same commit that
 * first made hearts actually FILL. Before it, userReacted was hardcoded false,
 * so the branch was unreachable and nobody could notice.
 *
 * So the operator's "no longer" is a true observation of a changed experience
 * from a feature that never existed. That distinction matters for the record,
 * and not at all for the fix: either way there was no way to change your mind.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Event, UnsignedEvent } from 'nostr-tools';
import { DELETE_KIND } from '@/types/social';
import type { SignerInterface, RelayClient } from '../headless';
import { reactToNote, retractEvent } from './noteService';

const feed = readFileSync(join(__dirname, 'useFeed.ts'), 'utf8');
const ui = readFileSync(
  join(__dirname, '..', '..', 'components', 'social', 'SocialFeed.tsx'),
  'utf8'
);

describe('undo', () => {
  // These three used to grep useNoteActions.ts for the event-building lines.
  // The building moved to noteService.ts so headless callers share it, so they
  // now call the real function instead of matching its source.
  const ME = 'aa'.repeat(32);
  const REACTION = 'bb'.repeat(32);
  const signer: SignerInterface = {
    getPublicKey: async () => ME,
    signEvent: async (u: UnsignedEvent): Promise<Event> => ({ ...u, id: 'ff'.repeat(32), sig: 'cc'.repeat(64) }),
    encrypt: async () => '',
    decrypt: async () => '',
  };
  const relayThatAccepts = () => {
    const published: Event[] = [];
    const relay: RelayClient = { publish: async (e) => (published.push(e), 1), fetch: async () => [] };
    return { relay, published };
  };

  it('uses NIP-09 kind:5', async () => {
    const { relay, published } = relayThatAccepts();
    await retractEvent(signer, relay, REACTION);
    expect(DELETE_KIND).toBe(5);
    expect(published[0].kind).toBe(DELETE_KIND);
  });

  it('references the reaction event, not the note', async () => {
    // A retraction names the kind:7 it retracts. Tagging the note would ask
    // relays to delete somebody else's post, which they would rightly ignore --
    // and which we should not be asking for.
    const { relay, published } = relayThatAccepts();
    await retractEvent(signer, relay, REACTION);
    expect(published[0].tags).toEqual([['e', REACTION]]);
  });

  it('returns the published event id so an action can be undone at once', async () => {
    // Without this, undo would have to wait for the relay echo to learn what it
    // just sent. Tapping a heart and immediately changing your mind is
    // ordinary, and should not depend on a round trip.
    const { relay } = relayThatAccepts();
    const outcome = await reactToNote(signer, relay, 'ee'.repeat(32), 'dd'.repeat(32));
    expect(outcome.eventId).toBe('ff'.repeat(32));
  });

  it('tracks which of our events belongs to which note', () => {
    expect(feed).toMatch(/ownReactionEventRef/);
    expect(feed).toMatch(/ownRepostEventRef/);
  });

  it('no longer returns early on an existing reaction', () => {
    // The exact line that made the control inert.
    expect(ui).not.toMatch(/if \(!canAct \|\| note\.userReacted\) return;/);
    expect(ui).not.toMatch(/if \(!canAct \|\| note\.userReposted\) return;/);
  });

  it('reverts the optimistic removal when the retraction fails', () => {
    // Same discipline as the original reaction fix: a heart that stays empty
    // after a failed retraction claims something that did not happen.
    expect(ui).toMatch(/Reaction not removed/);
    expect(ui).toMatch(/Repost not removed/);
  });

  it('says so when it cannot identify our own event', () => {
    // Reacted in a previous session and the echo has not arrived: we know they
    // reacted but not with which event. "Cannot undo yet" is not the same as
    // "did not react", and silently doing nothing is how the original bug felt.
    expect(ui).toMatch(/still loading which one was yours/);
  });
});
