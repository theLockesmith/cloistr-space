/**
 * @fileoverview Guards relay routing in note thread and feed engagement.
 *
 * WHAT BROKE
 *
 * Both bugs reported together:
 *   1. "Post not found" when clicking a note from the feed (the b6748d9 fix
 *      addressed eose timing; this is a SECOND, INDEPENDENT cause).
 *   2. "No activity on any notes" -- zero reactions, replies, reposts.
 *
 * ROOT CAUSE (shared by both)
 *
 * NDK routes a filter by whether it carries `authors`:
 *
 *   WITH authors    -> those authors' write relays (outbox model, dozens)
 *   WITHOUT authors -> ndk.explicitRelayUrls ONLY (one relay)
 *
 * useNoteThread's root subscription used `{ ids: [noteId] }` with no authors.
 * NDK routed it to explicitRelayUrls alone. Notes found in the feed via outbox
 * routing (from author write relays) were NOT on explicitRelayUrls, so the root
 * subscription eosed empty, rootSettledRef became true with root === null, and
 * notFound fired on a note visibly present in the feed.
 *
 * Verified on relay.cloistr.xyz: a followed user's notes return 0 results there
 * while the feed subscription (with authors) finds them via their write relay.
 *
 * useFeed's engagement subscription also had no authors and no relaySet.
 * Same single relay. Reactions and reposts to notes that lived on author relays
 * were not on that relay, so every note showed zero engagement.
 *
 * FIXES
 *
 * useNoteThread: when the author pubkey is known (from the nevent), include
 * `authors: [author]` in the root filter. NDK outbox routing then finds the
 * note on the right relay. NoteDetailView already decoded the author but was
 * silently discarding it; it now passes it through to useNoteThread.
 *
 * useFeed engagement: track all ever-connected relays (same monotonic pattern
 * as the global feed relay fix) and pass them as an explicit relaySet so the
 * engagement subscription spans the same relays the notes came from.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const threadSrc = readFileSync(join(__dirname, 'useNoteThread.ts'), 'utf8');
const feedSrc = readFileSync(join(__dirname, 'useFeed.ts'), 'utf8');
const detailSrc = readFileSync(
  join(__dirname, '../../components/social/NoteDetailView.tsx'),
  'utf8'
);

describe('useNoteThread author routing', () => {
  it('accepts an author parameter', () => {
    // The function signature must expose author to callers.
    expect(threadSrc).toMatch(/useNoteThread\([^)]*author\?:/);
  });

  it('includes authors in the root filter when author is provided', () => {
    // NDK outbox routing requires the `authors` field to know which relays to
    // query. Without it the filter goes to explicitRelayUrls alone and misses
    // notes that live on author write relays.
    expect(threadSrc).toMatch(/authors:\s*\[author\]/);
  });

  it('guards the authors spread on the author value', () => {
    // An unconditional `authors: [undefined]` sends NDK to an undefined
    // pubkey's relays -- which is a no-op at best and a never-returning query
    // at worst. The spread is only emitted when author is truthy.
    expect(threadSrc).toMatch(/author\s*\?\s*\{\s*authors:/);
  });

  it('includes author in the effect dependency array', () => {
    // A stale author value would persist after navigating between notes.
    expect(threadSrc).toMatch(/relayHints,\s*author\]/);
  });
});

describe('NoteDetailView passes author through', () => {
  it('passes the decoded author to ThreadBody', () => {
    // decodeIdentifier already returns author from the nevent, but it was
    // thrown away before reaching useNoteThread. This ensures it goes through.
    expect(detailSrc).toMatch(/author=\{resolved\.value\.author\}/);
  });

  it('ThreadBody accepts an author prop', () => {
    expect(detailSrc).toMatch(/ThreadBody\([^)]*author\?:/);
  });

  it('ThreadBody forwards author to useNoteThread', () => {
    expect(detailSrc).toMatch(/useNoteThread\(noteId,\s*relays,\s*author\)/);
  });
});

describe('useFeed engagement relay routing', () => {
  it('tracks connected relays for the engagement subscription', () => {
    // The engagement subscription has no authors, so it needs an explicit
    // relaySet or it falls back to explicitRelayUrls -- one relay.
    expect(feedSrc).toMatch(/engagementRelays\b/);
    expect(feedSrc).toMatch(/engagementRelaysRef/);
  });

  it('widens engagement relays monotonically', () => {
    // Same pattern as the global feed: widenRelays returns the SAME array when
    // nothing was added, so the engagement effect does not re-run on every
    // connection status change.
    expect(feedSrc).toMatch(/widenRelays\(\s*\n?\s*engagementRelaysRef\.current/);
  });

  it('passes the engagement relaySet to the subscription', () => {
    // Without this, the subscription goes to explicitRelayUrls regardless of
    // which relays carry the note's engagement.
    expect(feedSrc).toMatch(/relaySet:\s*service\?\.getRelaySetFor\(engagementRelays\)/);
  });

  it('includes engagementRelays in the engagement effect deps', () => {
    // When a new relay connects, engagementRelays widens and the subscription
    // re-opens to fetch engagement from the new relay.
    expect(feedSrc).toMatch(/engagementRelays,\s*service\]\)/);
  });
});
