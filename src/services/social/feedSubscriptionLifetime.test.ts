/**
 * @fileoverview The feed subscription must not close at eose.
 *
 * A source-level test, because the property lives in one argument to one call
 * and the behaviour it controls is only observable against real relays over
 * real time -- which no unit test here can reach.
 *
 * WHAT IT GUARDS. NDK registers a pool monitor alongside the relay query
 * (dist/index.js:9136) that subscribes any relay connecting LATER. closeOnEose
 * calls stop() at eose (index.js:9375), and stop() removes that monitor. So a
 * closing subscription snapshots whichever relays happened to be connected when
 * eose fired and never re-queries.
 *
 * With eighteen relays in the user's kind:10002 -- one of which does not
 * resolve at all, widening the window in which relays are still connecting --
 * which relays answer in time differs on every load. The operator saw it as a
 * post being present on one load and gone after a refresh, with no change in
 * the underlying data.
 *
 * `closeOnEose: true` looks like an obvious tidy-up: the query has finished, so
 * close it. That reasoning is why this test exists.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'useFeed.ts'), 'utf8');

describe('feed subscription lifetime', () => {
  it('does not close either subscription at eose', () => {
    // Both the note subscription and the engagement subscription must stay
    // open, for different reasons: this one to collect late-connecting relays,
    // the engagement one so a reaction published later is ever seen.
    expect(source).not.toContain('closeOnEose: true');
  });

  it('states closeOnEose explicitly rather than relying on a default', () => {
    // subscribeStream lets the caller choose, and NDK's own default is false.
    // Leaving it implicit would make a deliberate decision look like an
    // oversight to the next reader, who would then "fix" it.
    const occurrences = source.match(/closeOnEose: false/g) ?? [];

    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the reason next to the setting', () => {
    // The setting is one token and the consequence is a class of bug nobody
    // can reproduce on a fast connection to a single relay.
    expect(source).toMatch(/pool monitor/i);
  });
});
