/**
 * @fileoverview Tests for the cold-load instrumentation wired into useFeed.
 *
 * These do not test the hook as a whole (that requires an NDK context, relay
 * connections, and React rendering). They test the contract between useFeed
 * and the loadTiming singleton: each integration point fires the right mark,
 * and the marks are idempotent.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadTiming } from '@/services/performance';

describe('useFeed timing integration', () => {
  beforeEach(() => {
    loadTiming.reset();
  });

  it('contacts-ready mark fires and is idempotent', () => {
    // useFeed marks contacts-ready when the following list is non-empty.
    loadTiming.mark('contacts-ready');
    const first = loadTiming.getEntries().find((e) => e.level === 'contacts-ready')!;
    expect(first).toBeDefined();
    expect(first.elapsed).toBeGreaterThanOrEqual(0);

    // Second mark is ignored (first call wins).
    loadTiming.mark('contacts-ready');
    const entries = loadTiming.getEntries().filter((e) => e.level === 'contacts-ready');
    expect(entries).toHaveLength(1);
    expect(entries[0].timestamp).toBe(first.timestamp);
  });

  it('first-note mark fires and produces a positive TTFN', () => {
    expect(loadTiming.getTimeToFirstNote()).toBeNull();

    loadTiming.mark('first-note');

    const ttfn = loadTiming.getTimeToFirstNote();
    expect(ttfn).not.toBeNull();
    expect(ttfn!).toBeGreaterThanOrEqual(0);
  });

  it('first-engagement mark fires', () => {
    loadTiming.mark('first-engagement');
    const entry = loadTiming.getEntries().find((e) => e.level === 'first-engagement');
    expect(entry).toBeDefined();
  });

  it('feed-eose mark fires and seal prints summary without throwing', () => {
    loadTiming.mark('contacts-ready');
    loadTiming.mark('first-note');
    loadTiming.mark('feed-eose');
    loadTiming.seal();

    // Sealing twice is safe.
    expect(() => loadTiming.seal()).not.toThrow();
  });

  it('reset clears all marks for a new load cycle', () => {
    loadTiming.mark('contacts-ready');
    loadTiming.mark('first-note');
    loadTiming.mark('feed-eose');

    loadTiming.reset();

    expect(loadTiming.getTimeToFirstNote()).toBeNull();
    expect(loadTiming.getDelta('contacts-ready', 'first-note')).toBeNull();
    // Only page-start survives.
    expect(loadTiming.getEntries()).toHaveLength(1);
    expect(loadTiming.getEntries()[0].level).toBe('page-start');
  });

  it('the cold-load waterfall produces sensible deltas', () => {
    // Simulate the order useFeed fires marks in.
    loadTiming.mark('ndk-connected');
    loadTiming.mark('contacts-ready');
    loadTiming.mark('first-note');
    loadTiming.mark('first-profile');
    loadTiming.mark('first-engagement');
    loadTiming.mark('feed-eose');

    const contactsToNote = loadTiming.getDelta('contacts-ready', 'first-note');
    expect(contactsToNote).not.toBeNull();
    expect(contactsToNote!).toBeGreaterThanOrEqual(0);

    const noteToProfile = loadTiming.getDelta('first-note', 'first-profile');
    expect(noteToProfile).not.toBeNull();
    expect(noteToProfile!).toBeGreaterThanOrEqual(0);

    const noteToEngagement = loadTiming.getDelta('first-note', 'first-engagement');
    expect(noteToEngagement).not.toBeNull();
    expect(noteToEngagement!).toBeGreaterThanOrEqual(0);

    // All entries should be ordered by timestamp.
    const entries = loadTiming.getEntries();
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].timestamp).toBeGreaterThanOrEqual(entries[i - 1].timestamp);
    }
  });

  it('getDelta returns null when a mark is missing', () => {
    loadTiming.mark('contacts-ready');
    // first-note never marked.
    expect(loadTiming.getDelta('contacts-ready', 'first-note')).toBeNull();
  });
});
