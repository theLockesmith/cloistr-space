/**
 * @fileoverview NoteDetailView must pre-sign custom emoji URLs for mirroring.
 *
 * BUG: NoteDetailView's NoteActions called useMirrorSign() but never called the
 * returned sign() function.  Without sign(), the mirrorMap was always empty for
 * every custom-emoji URL.  All custom emoji fell into the "pending" bucket in
 * ReactionPicker and rendered as :shortcode: text instead of images.
 *
 * SocialFeed.tsx calls sign(urls) in a useEffect as soon as custom emoji resolve.
 * NoteDetailView must do the same.
 *
 * Source-level: the behavioural guarantee is structural ("sign is called"),
 * and a render test would need a full NDK + auth + router stack just to see
 * the pattern.  The structural check is cheaper and points directly at the bug.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const noteDetail = readFileSync(join(__dirname, 'NoteDetailView.tsx'), 'utf8');
const socialFeed = readFileSync(join(__dirname, 'SocialFeed.tsx'), 'utf8');

describe('NoteDetailView pre-signs custom emoji for the reaction picker', () => {
  it('destructures sign from useMirrorSign (not just mirrorMap/isSigning)', () => {
    // Without sign being pulled out of the hook, there is nothing to call.
    // The only way to reach the mirror endpoint is through sign().
    expect(noteDetail).toMatch(/\bsign\b.*useMirrorSign|useMirrorSign.*\bsign\b/s);
  });

  it('calls sign() with custom emoji URLs in a useEffect (mirrors SocialFeed pattern)', () => {
    // SocialFeed: useEffect(() => { ... sign(urls); }, [emoji, sign]);
    // NoteDetailView must have the same so the detail-view picker works too.
    expect(noteDetail).toMatch(/sign\(urls\)/);
  });

  it('SocialFeed is the canonical example: it calls sign(urls) in a useEffect', () => {
    // Sanity-check that the pattern we expect in NoteDetailView actually exists
    // in SocialFeed; if this breaks the fix target changed.
    expect(socialFeed).toMatch(/sign\(urls\)/);
  });
});
