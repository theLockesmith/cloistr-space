/**
 * @fileoverview Calendar hook using NDK subscriptions
 * Subscribes to NIP-52 calendar events (kinds 31922/31923)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { useNdk, subscribeStream, type NDKEvent } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { trackAnswers, useUnreachable, withReachability, NO_RELAY_ANSWERED } from './widgetReads';
import type { CalendarEvent, WidgetState } from '@/types/activity';
import { CALENDAR_DATE_KIND, CALENDAR_TIME_KIND } from '@/types/activity';

/** Maximum events to display */
const MAX_EVENTS = 10;

/**
 * Local midnight of a NIP-52 date (YYYY-MM-DD), plus `addDays`, in seconds.
 *
 * `new Date('2026-10-20')` parses as UTC midnight, which is the previous
 * evening anywhere west of Greenwich and the wrong day for every all-day
 * comparison made against local time. NaN for anything that is not a date.
 */
function localDayStart(date: string, addDays = 0): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  return Math.floor(new Date(+m[1], +m[2] - 1, +m[3] + addDays).getTime() / 1000);
}

/** Parse a NIP-52 calendar event */
export function parseCalendarEvent(event: NDKEvent): CalendarEvent | null {
  const tags = event.tags;
  const isDateEvent = event.kind === CALENDAR_DATE_KIND;

  // Required: d-tag identifier
  const dTag = tags.find((t) => t[0] === 'd');
  if (!dTag?.[1]) return null;

  // Title from 'title' tag or 'name' tag
  const titleTag = tags.find((t) => t[0] === 'title' || t[0] === 'name');
  const title = titleTag?.[1] || 'Untitled event';

  // Description/summary
  const descTag = tags.find((t) => t[0] === 'description' || t[0] === 'summary');
  const description = descTag?.[1] || event.content || undefined;

  // Start time
  const startTag = tags.find((t) => t[0] === 'start');
  if (!startTag?.[1]) return null;

  let startTime: number;
  if (isDateEvent) {
    startTime = localDayStart(startTag[1]);
  } else {
    // Time-based: Unix timestamp
    startTime = parseInt(startTag[1], 10);
  }

  if (isNaN(startTime)) return null;

  // End time
  const endTag = tags.find((t) => t[0] === 'end');
  let endTime: number | undefined;
  if (isDateEvent) {
    // NIP-52: a date-based end is exclusive, and with none the event occupies
    // its start day. Defaulting it to "start + 1 hour" instead is what made an
    // all-day event for today vanish from upcoming an hour after midnight.
    endTime = endTag?.[1] ? localDayStart(endTag[1]) : localDayStart(startTag[1], 1);
    if (isNaN(endTime)) endTime = undefined;
  } else if (endTag?.[1]) {
    endTime = parseInt(endTag[1], 10);
  }

  // Location
  const locationTag = tags.find((t) => t[0] === 'location');
  const location = locationTag?.[1];

  // Group association
  const groupTag = tags.find((t) => t[0] === 'h');
  const groupId = groupTag?.[1];

  // Participants (p tags)
  const participants = tags.filter((t) => t[0] === 'p').map((t) => t[1]);

  return {
    id: event.id,
    pubkey: event.pubkey,
    identifier: dTag[1],
    title,
    description,
    startTime,
    endTime,
    allDay: isDateEvent,
    location,
    groupId,
    participants,
    createdAt: event.created_at || Math.floor(Date.now() / 1000),
  };
}

/** True while the event has not ended and starts within `daysAhead` days of `now`. */
export function isUpcoming(e: CalendarEvent, now: number, daysAhead: number): boolean {
  const futureLimit = now + daysAhead * 24 * 60 * 60;
  const endTime = e.endTime || e.startTime + 3600; // Default 1 hour
  return endTime >= now && e.startTime <= futureLimit;
}

/** Calendar view modes */
export type CalendarView = 'list' | 'day' | 'week';

interface UseCalendarOptions {
  /** Limit number of events */
  limit?: number;
  /** Filter by group */
  groupId?: string;
  /** Only show upcoming events */
  upcomingOnly?: boolean;
  /** Days ahead to look for events */
  daysAhead?: number;
  /** Auto-subscribe on mount */
  autoSubscribe?: boolean;
}

interface UseCalendarReturn extends WidgetState<CalendarEvent> {
  refresh: () => void;
  todayEvents: CalendarEvent[];
  upcomingEvents: CalendarEvent[];
  /** Get events for a specific date */
  getEventsForDate: (date: Date) => CalendarEvent[];
  /** Get events for a date range (week view) */
  getEventsForRange: (startDate: Date, endDate: Date) => CalendarEvent[];
}

/**
 * Hook for subscribing to calendar events
 * Returns events sorted by start time
 */
export function useCalendar(options: UseCalendarOptions = {}): UseCalendarReturn {
  const {
    limit = MAX_EVENTS,
    groupId,
    upcomingOnly = true,
    daysAhead = 7,
    autoSubscribe = true,
  } = options;
  const { subscribe, isConnected } = useNdk();
  const unreachable = useUnreachable(isConnected);
  const { pubkey, isAuthenticated } = useAuthStore();

  const [state, setState] = useState<WidgetState<CalendarEvent>>({
    items: [],
    isLoading: true,
    error: null,
    lastUpdated: null,
  });

  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  // Map by d-tag identifier for addressable event deduplication
  const eventsMapRef = useRef<Map<string, CalendarEvent>>(new Map());

  const filterAndSort = useCallback((events: CalendarEvent[]): CalendarEvent[] => {
    const now = Math.floor(Date.now() / 1000);
    return events
      .filter((e) => !upcomingOnly || isUpcoming(e, now, daysAhead))
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, limit);
  }, [upcomingOnly, daysAhead, limit]);

  const startSubscription = useCallback(() => {
    if (!subscribe || !isConnected || !pubkey) {
      // Not connected is not "nothing here": stay loading, and useUnreachable
      // turns it into an error if the connection does not come.
      setState((prev) => ({ ...prev, isLoading: true }));
      return;
    }

    // Clean up existing subscription
    subscriptionRef.current?.unsubscribe();
    eventsMapRef.current.clear();

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    // Build filter - look for events created by user OR where user is participant
    const filters: NDKFilter[] = [
      // User's own events
      {
        kinds: [CALENDAR_DATE_KIND as number, CALENDAR_TIME_KIND as number],
        authors: [pubkey],
      },
      // Events where user is tagged
      {
        kinds: [CALENDAR_DATE_KIND as number, CALENDAR_TIME_KIND as number],
        '#p': [pubkey],
      },
    ];

    // Add group filter if specified
    if (groupId) {
      filters.forEach((f) => {
        f['#h'] = [groupId];
      });
    }

    try {
      const tracked = trackAnswers({
        onEvent: (event: NDKEvent) => {
        const calEvent = parseCalendarEvent(event);
        if (!calEvent) return;

        // Use d-tag as key for addressable events
        const existing = eventsMapRef.current.get(calEvent.identifier);
        if (!existing || calEvent.createdAt >= existing.createdAt) {
          eventsMapRef.current.set(calEvent.identifier, calEvent);
        }

        setState({
          items: filterAndSort(Array.from(eventsMapRef.current.values())),
          isLoading: false,
          error: null,
          lastUpdated: Date.now(),
        });
      },
        onEose: () => {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          lastUpdated: Date.now(),
        }));
      },
      }, () =>
        // Nobody answered: an error, never "nothing here". Items that did arrive stay.
        setState((prev) => ({ ...prev, isLoading: false, error: prev.items.length ? prev.error : NO_RELAY_ANSWERED }))
      );
      const subscription = subscribeStream(subscribe, filters, tracked.handlers, { closeOnEose: false });




      subscriptionRef.current = {
        unsubscribe: () => {
          tracked.cancel();
          subscription.stop();
        },
      };
    } catch (err) {
      setState({
        items: [],
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch calendar events',
        lastUpdated: Date.now(),
      });
    }
  }, [subscribe, isConnected, pubkey, groupId, filterAndSort]);

  // Auto-subscribe on mount
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (autoSubscribe && isAuthenticated && isConnected) {
      // Defer to avoid sync setState in effect
      timeoutId = setTimeout(() => {
        startSubscription();
      }, 0);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      subscriptionRef.current?.unsubscribe();
    };
  }, [autoSubscribe, isAuthenticated, isConnected, startSubscription]);

  // Compute today's events
  const todayEvents = state.items.filter((e) => {
    const now = new Date();
    const eventDate = new Date(e.startTime * 1000);
    return (
      eventDate.getFullYear() === now.getFullYear() &&
      eventDate.getMonth() === now.getMonth() &&
      eventDate.getDate() === now.getDate()
    );
  });

  // Compute upcoming (non-today) events
  const upcomingEvents = state.items.filter((e) => {
    const now = new Date();
    const eventDate = new Date(e.startTime * 1000);
    return !(
      eventDate.getFullYear() === now.getFullYear() &&
      eventDate.getMonth() === now.getMonth() &&
      eventDate.getDate() === now.getDate()
    );
  });

  // Get events for a specific date
  const getEventsForDate = useCallback((date: Date): CalendarEvent[] => {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const dayStartTs = Math.floor(dayStart.getTime() / 1000);
    const dayEndTs = Math.floor(dayEnd.getTime() / 1000);

    return state.items.filter((e) => {
      const eventEnd = e.endTime || e.startTime + 3600;
      // Event overlaps with this day
      return e.startTime <= dayEndTs && eventEnd >= dayStartTs;
    }).sort((a, b) => a.startTime - b.startTime);
  }, [state.items]);

  // Get events for a date range
  const getEventsForRange = useCallback((startDate: Date, endDate: Date): CalendarEvent[] => {
    const rangeStart = new Date(startDate);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(endDate);
    rangeEnd.setHours(23, 59, 59, 999);

    const rangeStartTs = Math.floor(rangeStart.getTime() / 1000);
    const rangeEndTs = Math.floor(rangeEnd.getTime() / 1000);

    return state.items.filter((e) => {
      const eventEnd = e.endTime || e.startTime + 3600;
      // Event overlaps with this range
      return e.startTime <= rangeEndTs && eventEnd >= rangeStartTs;
    }).sort((a, b) => a.startTime - b.startTime);
  }, [state.items]);

  return {
    ...withReachability(state, unreachable),
    refresh: startSubscription,
    todayEvents,
    upcomingEvents,
    getEventsForDate,
    getEventsForRange,
  };
}
