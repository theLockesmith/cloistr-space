/**
 * @fileoverview Deleting your own post.
 *
 * A user could not retract anything they had posted. That is a trust problem
 * rather than a missing feature: "you cannot take it back" is a property people
 * reasonably assume is false, and discovering otherwise after posting something
 * they regret is the worst possible moment to learn it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const feed = readFileSync(join(__dirname, 'SocialFeed.tsx'), 'utf8');
const menu = readFileSync(join(__dirname, 'OwnNoteMenu.tsx'), 'utf8');
const useFeed = readFileSync(
  join(__dirname, '..', '..', 'services', 'social', 'useFeed.ts'),
  'utf8'
);

describe('delete own note', () => {
  it('only offers the control on your own posts', () => {
    // NIP-09 retracts only events you signed. On someone else's note the button
    // would publish a kind:5 that every relay ignores -- an inert control that
    // looks like it worked.
    expect(feed).toMatch(/viewerPubkey === note\.pubkey/);
  });

  it('confirms before deleting', () => {
    expect(menu).toMatch(/Delete anyway/);
    expect(menu).toMatch(/Keep it/);
  });

  it('says what deletion actually means rather than promising more', () => {
    // A kind:5 is a REQUEST. Relays may ignore it and other clients may keep
    // showing the post. Promising removal would be a lie the protocol makes
    // impossible to keep, and this is exactly the moment a user needs the
    // truth rather than reassurance.
    expect(menu).toMatch(/copies may\s*\n?\s*remain/);
  });

  it('keeps the id in the seen-set when removing', () => {
    // The subscription stays open and relays may keep serving the event, so a
    // note removed from the list would be redelivered and reappear seconds
    // after the user deleted it. Staying "seen" makes the removal stick.
    const removal = useFeed.slice(useFeed.indexOf('const removeNote'));
    expect(removal.slice(0, 200)).not.toMatch(/seenIdsRef\.current\.delete/);
    expect(useFeed).toMatch(/id STAYS in seenIdsRef/);
  });

  it('restores the post when the retraction fails', () => {
    // The one action where believing a false success is worst: a post that
    // stays gone after a failed delete tells the user it was removed when it
    // is still public.
    expect(feed).toMatch(/restoreNote\(note\)/);
    expect(feed).toContain('Post not deleted');
  });

  it('does not re-add a note that is already present', () => {
    // Restore runs on a failure path that can race a redelivery. Adding blindly
    // would duplicate the post it was trying to bring back.
    expect(useFeed).toMatch(/prev\.some\(\(n\) => n\.id === note\.id\)/);
  });
});
