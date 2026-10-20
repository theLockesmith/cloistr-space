/**
 * @fileoverview All-day (date-based) calendar events cover whole local days.
 *
 * The Create Event form defaults to an all-day event for today with no end
 * date. That event used to be read as starting at UTC midnight and lasting one
 * hour, so it dropped out of "upcoming" an hour after UTC midnight -- in effect
 * an event created for today never appeared, while the form said
 * "Event created".
 *
 * NIP-52: a date-based event's `end` is EXCLUSIVE, and with no `end` the event
 * occupies its start day.
 */

import { describe, it, expect } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { parseCalendarEvent, isUpcoming } from './useCalendar';
import { allDayTags } from '@/components/activity/CreateEventModal';
import { CALENDAR_DATE_KIND } from '@/types/activity';

const localMidnight = (y: number, m: number, d: number) =>
  Math.floor(new Date(y, m - 1, d).getTime() / 1000);

function dateEvent(tags: string[][]): NDKEvent {
  return {
    id: 'e1',
    pubkey: 'p'.repeat(64),
    kind: CALENDAR_DATE_KIND,
    created_at: 1,
    content: '',
    tags: [['d', 'x'], ['title', 't'], ...tags],
  } as unknown as NDKEvent;
}

describe('all-day calendar events', () => {
  it('start at local midnight, not UTC midnight', () => {
    const e = parseCalendarEvent(dateEvent([['start', '2026-10-20']]))!;
    expect(e.startTime).toBe(localMidnight(2026, 10, 20));
  });

  it('with no end, last the whole start day', () => {
    const e = parseCalendarEvent(dateEvent([['start', '2026-10-20']]))!;
    expect(e.endTime).toBe(localMidnight(2026, 10, 21));
  });

  it('treat end as exclusive, as NIP-52 says', () => {
    const e = parseCalendarEvent(dateEvent([['start', '2026-10-20'], ['end', '2026-10-23']]))!;
    expect(e.endTime).toBe(localMidnight(2026, 10, 23));
  });

  it("count as upcoming all through their day, including late evening", () => {
    const e = parseCalendarEvent(dateEvent([['start', '2026-10-20']]))!;
    const lateEvening = Math.floor(new Date(2026, 9, 20, 23, 30).getTime() / 1000);
    expect(isUpcoming(e, lateEvening, 7)).toBe(true);
    const nextMorning = Math.floor(new Date(2026, 9, 21, 0, 30).getTime() / 1000);
    expect(isUpcoming(e, nextMorning, 7)).toBe(false);
  });

  it('are written so the chosen last day is included', () => {
    // The form's end-date field is the last day the event runs. NIP-52's end is
    // exclusive, so the tag has to carry the day after it.
    expect(allDayTags('2026-10-20', '2026-10-20')).toEqual([['start', '2026-10-20']]);
    expect(allDayTags('2026-10-20', '2026-10-22')).toEqual([
      ['start', '2026-10-20'],
      ['end', '2026-10-23'],
    ]);
    // Month and year rollover.
    expect(allDayTags('2026-12-30', '2026-12-31')).toEqual([
      ['start', '2026-12-30'],
      ['end', '2027-01-01'],
    ]);
  });

  it('round-trip: a multi-day event written by the form covers every chosen day', () => {
    const e = parseCalendarEvent(dateEvent(allDayTags('2026-10-20', '2026-10-22')))!;
    const lastDayEvening = Math.floor(new Date(2026, 9, 22, 22, 0).getTime() / 1000);
    expect(isUpcoming(e, lastDayEvening, 7)).toBe(true);
  });
});
