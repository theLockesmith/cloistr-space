/**
 * @fileoverview Guards "post not found" against firing on a post that exists.
 *
 * Operator: "when we try to comment or expand a post we get 'post not found'"
 * -- on notes visibly present in the feed.
 *
 * CAUSE: useNoteThread opens THREE subscriptions (the note, its replies, its
 * reactions) and every one of them called the same coalesced flush, which set
 *
 *     settled: true
 *
 * unconditionally. The replies and engagement queries usually eose instantly,
 * having nothing to return, so the thread was marked settled while the root
 * event was still in flight -- and notFound is `settled && root === null`.
 *
 * The bitter part: the code carried a comment saying "only claim not found once
 * the query actually settled", and then settled on the wrong query. Writing the
 * guard is not the same as implementing it.
 *
 * Source-level, because reproducing it needs three relay subscriptions eosing
 * in a specific order.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'useNoteThread.ts'), 'utf8');

describe('thread settle', () => {
  it('does not hard-code settled to true', () => {
    // The literal that caused it.
    expect(source).not.toMatch(/settled:\s*true\s*,\s*\}\)/);
  });

  it('derives settled from the root query alone', () => {
    expect(source).toMatch(/settled:\s*rootSettledRef\.current/);
  });

  it('sets the root-settled flag in exactly one place', () => {
    // Three subscriptions, one of which may settle the thread. If a later
    // change wires this to another eose, the bug returns in a form that looks
    // like a harmless consistency fix.
    const assignments = source.match(/rootSettledRef\.current = true/g) ?? [];

    expect(assignments).toHaveLength(1);
  });

  it('resets the flag when the thread changes', () => {
    // Without this, opening a second post inherits the first's settledness and
    // can report not-found before its own query has run.
    expect(source).toMatch(/rootSettledRef\.current = false/);
  });

  it('still gates notFound on settled', () => {
    // The property the whole thing exists to protect: before the query
    // finishes, "no such note" is indistinguishable from "still looking".
    expect(source).toMatch(/notFound:\s*Boolean\(current\?\.settled\)/);
  });
});
