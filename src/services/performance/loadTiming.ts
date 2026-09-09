/**
 * @fileoverview Instrument the cold-load pipeline.
 *
 * A returning user's feed hits six sequential dependency levels, and each is
 * gated by the slowest relay in that level. Before optimising anything we need
 * to know WHICH level is actually slow, because twice in the same week we
 * attributed delay to the wrong cause.
 *
 * The six levels (from architecture/caching-service.md):
 *
 *   1. Contact list   - fetch kind:33000 / kind:3
 *   2. Relay lists     - fetch kind:10002 for each followed author
 *   3. Relay connect   - TCP+TLS+WS handshakes to the author relay union
 *   4. First note      - kind:1 query results arrive
 *   5. Profiles        - kind:0 for every author on screen
 *   6. Engagement      - kind:7/6/1 counts for visible notes
 *
 * This module records wall-clock marks at each boundary. It does not attempt to
 * isolate levels 2 and 3 from inside NDK's outbox model, because NDK pipelines
 * them internally and the only observable moment is when the first result
 * arrives at the subscription. What it CAN separate is contacts-ready (the
 * moment the feed filter has authors to query) from first-note (the moment a
 * note is rendered), which is the dependency between levels 1-3 and level 4.
 *
 * Uses performance.mark() and performance.measure() so results show up
 * in the browser's Performance panel, not just in console output.
 */

export type LoadLevel =
  | 'page-start'
  | 'ndk-connected'
  | 'contacts-ready'
  | 'first-note'
  | 'first-profile'
  | 'first-engagement'
  | 'feed-eose';

interface TimingEntry {
  level: LoadLevel;
  /** Absolute timestamp from performance.now() */
  timestamp: number;
  /** Delta from page-start, in ms */
  elapsed: number;
}

/**
 * One load cycle's timings. Created on page load or on manual refresh.
 *
 * Singleton: there is one active cycle at a time. A refresh resets it.
 */
class LoadTimingTracker {
  private marks = new Map<LoadLevel, number>();
  private origin = 0;
  private listeners = new Set<(entries: TimingEntry[]) => void>();
  private sealed = false;

  constructor() {
    this.reset();
  }

  /**
   * Start a new measurement cycle. Called once at page load and again on
   * manual feed refresh.
   */
  reset(): void {
    this.marks.clear();
    this.sealed = false;
    this.origin = performance.now();
    this.mark('page-start');
  }

  /**
   * Record a level boundary. Idempotent: the FIRST call for each level wins,
   * because we want the earliest arrival, not the last relay to answer.
   */
  mark(level: LoadLevel): void {
    if (this.marks.has(level)) return;

    const now = performance.now();
    this.marks.set(level, now);

    // Browser Performance API integration. Try/catch because some
    // environments (SSR, old Safari) may not support the full API.
    try {
      performance.mark(`cloistr:${level}`);
      if (level !== 'page-start') {
        performance.measure(
          `cloistr:page-start -> ${level}`,
          'cloistr:page-start',
          `cloistr:${level}`
        );
      }
    } catch {
      // Not critical. Console report still works.
    }

    this.notify();

    // Log each mark as it happens, so a developer watching the console sees
    // the waterfall in real time rather than having to wait for the summary.
    const elapsed = now - this.origin;
    if (typeof console !== 'undefined') {
      console.debug(
        `[perf] ${level}: ${elapsed.toFixed(0)}ms`,
        level === 'first-note'
          ? `(TTFN: ${elapsed.toFixed(0)}ms)`
          : ''
      );
    }
  }

  /**
   * Return the current marks as a sorted array.
   */
  getEntries(): TimingEntry[] {
    return Array.from(this.marks.entries())
      .map(([level, timestamp]) => ({
        level,
        timestamp,
        elapsed: timestamp - this.origin,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * The headline number: page-start to first-note.
   * Returns null if first-note has not been marked yet.
   */
  getTimeToFirstNote(): number | null {
    const start = this.marks.get('page-start');
    const note = this.marks.get('first-note');
    if (start == null || note == null) return null;
    return note - start;
  }

  /**
   * Delta between two marks, in ms. Null if either is missing.
   */
  getDelta(from: LoadLevel, to: LoadLevel): number | null {
    const a = this.marks.get(from);
    const b = this.marks.get(to);
    if (a == null || b == null) return null;
    return b - a;
  }

  /**
   * Print a summary table to the console. Called automatically when
   * feed-eose fires, or on demand.
   */
  printSummary(): void {
    const entries = this.getEntries();
    if (entries.length === 0) return;

    const rows = entries.map((e, i) => {
      const delta =
        i === 0 ? 0 : e.timestamp - entries[i - 1].timestamp;
      return {
        level: e.level,
        'elapsed (ms)': Math.round(e.elapsed),
        'delta (ms)': Math.round(delta),
      };
    });

    console.group('[perf] Cold-load timing breakdown');
    console.table(rows);

    const ttfn = this.getTimeToFirstNote();
    if (ttfn != null) {
      console.log(`Time to first note: ${ttfn.toFixed(0)}ms`);
    }

    // The gaps that matter for caching decisions.
    const contactsToNote = this.getDelta('contacts-ready', 'first-note');
    if (contactsToNote != null) {
      console.log(
        `Contacts-ready -> first note (levels 2-4): ${contactsToNote.toFixed(0)}ms`
      );
    }

    const noteToProfile = this.getDelta('first-note', 'first-profile');
    if (noteToProfile != null) {
      console.log(
        `First note -> first profile (level 5): ${noteToProfile.toFixed(0)}ms`
      );
    }

    const noteToEngagement = this.getDelta('first-note', 'first-engagement');
    if (noteToEngagement != null) {
      console.log(
        `First note -> first engagement (level 6): ${noteToEngagement.toFixed(0)}ms`
      );
    }

    console.groupEnd();
  }

  /**
   * Seal the cycle: stop accepting new marks and print the summary.
   * Called when feed-eose fires, since that is the end of the initial load.
   */
  seal(): void {
    if (this.sealed) return;
    this.sealed = true;
    this.printSummary();
  }

  /**
   * Subscribe to mark changes. Returns an unsubscribe function.
   */
  subscribe(fn: (entries: TimingEntry[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const entries = this.getEntries();
    for (const fn of this.listeners) {
      fn(entries);
    }
  }
}

/**
 * The singleton tracker. One per page load.
 *
 * Exported as a concrete instance, not a class, because every call site
 * needs the SAME tracker. A second instance would measure a different
 * origin and produce meaningless deltas.
 */
export const loadTiming = new LoadTimingTracker();

// Make it accessible from the browser console for ad-hoc inspection.
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__cloistrPerf = loadTiming;
}
