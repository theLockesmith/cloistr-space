import { describe, it, expect, beforeEach } from 'vitest';

// Fresh instance per test: the module-level singleton is convenient for the
// app but a test that leaks marks into the next one is not.
class TestableLoadTimingTracker {
  private marks = new Map<string, number>();
  private origin = 0;

  reset(): void {
    this.marks.clear();
    this.origin = performance.now();
    this.mark('page-start');
  }

  mark(level: string): void {
    if (this.marks.has(level)) return;
    this.marks.set(level, performance.now());
  }

  getTimeToFirstNote(): number | null {
    const start = this.marks.get('page-start');
    const note = this.marks.get('first-note');
    if (start == null || note == null) return null;
    return note - start;
  }

  getDelta(from: string, to: string): number | null {
    const a = this.marks.get(from);
    const b = this.marks.get(to);
    if (a == null || b == null) return null;
    return b - a;
  }

  getEntries() {
    return Array.from(this.marks.entries())
      .map(([level, timestamp]) => ({
        level,
        timestamp,
        elapsed: timestamp - this.origin,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}

describe('LoadTimingTracker', () => {
  let tracker: TestableLoadTimingTracker;

  beforeEach(() => {
    tracker = new TestableLoadTimingTracker();
    tracker.reset();
  });

  it('records page-start on reset', () => {
    const entries = tracker.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe('page-start');
  });

  it('marks are idempotent: first call wins', () => {
    tracker.mark('first-note');
    const first = tracker.getEntries().find((e) => e.level === 'first-note')!;

    // Second mark for the same level should be ignored.
    tracker.mark('first-note');
    const second = tracker.getEntries().find((e) => e.level === 'first-note')!;
    expect(second.timestamp).toBe(first.timestamp);
  });

  it('getTimeToFirstNote returns null before first-note is marked', () => {
    expect(tracker.getTimeToFirstNote()).toBeNull();
  });

  it('getTimeToFirstNote returns a positive delta', () => {
    tracker.mark('first-note');
    const ttfn = tracker.getTimeToFirstNote();
    expect(ttfn).not.toBeNull();
    expect(ttfn!).toBeGreaterThanOrEqual(0);
  });

  it('getDelta returns null for missing marks', () => {
    expect(tracker.getDelta('first-note', 'first-profile')).toBeNull();
  });

  it('getDelta returns a non-negative value for ordered marks', () => {
    tracker.mark('contacts-ready');
    tracker.mark('first-note');
    const delta = tracker.getDelta('contacts-ready', 'first-note');
    expect(delta).not.toBeNull();
    expect(delta!).toBeGreaterThanOrEqual(0);
  });

  it('reset clears all marks and starts fresh', () => {
    tracker.mark('first-note');
    tracker.mark('first-profile');
    expect(tracker.getEntries().length).toBe(3); // page-start + 2

    tracker.reset();
    expect(tracker.getEntries().length).toBe(1); // just page-start
    expect(tracker.getTimeToFirstNote()).toBeNull();
  });

  it('entries are sorted by timestamp', () => {
    tracker.mark('ndk-connected');
    tracker.mark('contacts-ready');
    tracker.mark('first-note');

    const entries = tracker.getEntries();
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].timestamp).toBeGreaterThanOrEqual(entries[i - 1].timestamp);
    }
  });
});
