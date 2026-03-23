/**
 * @fileoverview Calendar hook using NDK subscriptions
 * Subscribes to NIP-52 calendar events (kinds 31922/31923)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { useNdk, type NDKEvent } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { CalendarEvent, WidgetState } from '@/types/activity';
import { CALENDAR_DATE_KIND, CALENDAR_TIME_KIND } from '@/types/activity';

/** Maximum events to display */
const MAX_EVENTS = 10;

/** Parse a NIP-52 calendar event */
function parseCalendarEvent(event: NDKEvent): CalendarEvent | null {
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
    // Date-based: YYYY-MM-DD format
    const date = new Date(startTag[1]);
    startTime = Math.floor(date.getTime() / 1000);
  } else {
    // Time-based: Unix timestamp
    startTime = parseInt(startTag[1], 10);
  }

  if (isNaN(startTime)) return null;

  // End time
  const endTag = tags.find((t) => t[0] === 'end');
  let endTime: number | undefined;
  if (endTag?.[1]) {
    if (isDateEvent) {
      const date = new Date(endTag[1]);
      endTime = Math.floor(date.getTime() / 1000);
    } else {
      endTime = parseInt(endTag[1], 10);
    }
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
    const futureLimit = now + daysAhead * 24 * 60 * 60;

    return events
      .filter((e) => {
        if (upcomingOnly) {
          // Include events that haven't ended yet
          const endTime = e.endTime || e.startTime + 3600; // Default 1 hour
          return endTime >= now && e.startTime <= futureLimit;
        }
        return true;
      })
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, limit);
  }, [upcomingOnly, daysAhead, limit]);

  const startSubscription = useCallback(() => {
    if (!subscribe || !isConnected || !pubkey) {
      setState((prev) => ({ ...prev, isLoading: false }));
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
      const subscription = subscribe(filters, { closeOnEose: false });

      subscription.on('event', (event: NDKEvent) => {
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
      });

      subscription.on('eose', () => {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          lastUpdated: Date.now(),
        }));
      });

      subscription.start();

      subscriptionRef.current = {
        unsubscribe: () => subscription.stop(),
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

  return {
    ...state,
    refresh: startSubscription,
    todayEvents,
    upcomingEvents,
  };
}
