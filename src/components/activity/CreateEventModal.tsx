/**
 * @fileoverview Quick event creation modal
 * Creates NIP-52 calendar events (kind:31922 date-based or kind:31923 time-based)
 */

import { useState, useCallback, type FormEvent } from 'react';
import { useNdk } from '@/services/nostr';
import { CALENDAR_DATE_KIND, CALENDAR_TIME_KIND } from '@/types/activity';

interface CreateEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEventCreated?: () => void;
  /** Pre-selected date */
  initialDate?: Date;
  /** Group to associate event with */
  groupId?: string;
}

export function CreateEventModal({
  isOpen,
  onClose,
  onEventCreated,
  initialDate = new Date(),
  groupId,
}: CreateEventModalProps) {
  const { publish, createEvent, isConnected } = useNdk();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isAllDay, setIsAllDay] = useState(true);
  const [startDate, setStartDate] = useState(formatDateInput(initialDate));
  const [startTime, setStartTime] = useState('09:00');
  const [endDate, setEndDate] = useState(formatDateInput(initialDate));
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    setTitle('');
    setDescription('');
    setIsAllDay(true);
    setStartDate(formatDateInput(new Date()));
    setStartTime('09:00');
    setEndDate(formatDateInput(new Date()));
    setEndTime('10:00');
    setLocation('');
    setError(null);
    onClose();
  }, [isSubmitting, onClose]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!publish || !createEvent || !isConnected) {
      setError('Not connected to relay');
      return;
    }

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const event = createEvent();
      if (!event) throw new Error('Failed to create event');

      // Determine event kind based on all-day setting
      event.kind = isAllDay ? CALENDAR_DATE_KIND : CALENDAR_TIME_KIND;
      event.content = description;

      // Generate unique identifier
      const identifier = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      // Build tags
      const tags: string[][] = [
        ['d', identifier],
        ['title', title.trim()],
      ];

      if (description) {
        tags.push(['summary', description]);
      }

      if (isAllDay) {
        // Date-based event: YYYY-MM-DD format
        tags.push(['start', startDate]);
        if (endDate && endDate !== startDate) {
          tags.push(['end', endDate]);
        }
      } else {
        // Time-based event: Unix timestamp
        const startDateTime = new Date(`${startDate}T${startTime}`);
        const endDateTime = new Date(`${endDate}T${endTime}`);
        tags.push(['start', Math.floor(startDateTime.getTime() / 1000).toString()]);
        tags.push(['end', Math.floor(endDateTime.getTime() / 1000).toString()]);
      }

      if (location) {
        tags.push(['location', location]);
      }

      if (groupId) {
        tags.push(['h', groupId]);
      }

      event.tags = tags;

      await publish(event);
      onEventCreated?.();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setIsSubmitting(false);
    }
  }, [publish, createEvent, isConnected, title, description, isAllDay, startDate, startTime, endDate, endTime, location, groupId, onEventCreated, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-cloistr-light">New Event</h2>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light disabled:opacity-50"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label htmlFor="event-title" className="mb-1 block text-sm font-medium text-cloistr-light/80">
              Title
            </label>
            <input
              id="event-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              className="w-full rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light placeholder:text-cloistr-light/40 focus:border-cloistr-primary/50 focus:outline-none"
              required
            />
          </div>

          {/* All-day toggle */}
          <div className="flex items-center gap-2">
            <input
              id="all-day"
              type="checkbox"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
              className="h-4 w-4 rounded border-cloistr-light/20 bg-transparent text-cloistr-primary focus:ring-cloistr-primary"
            />
            <label htmlFor="all-day" className="text-sm text-cloistr-light/80">
              All-day event
            </label>
          </div>

          {/* Date/Time inputs */}
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="start-date" className="mb-1 block text-xs text-cloistr-light/60">
                  Start Date
                </label>
                <input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (e.target.value > endDate) setEndDate(e.target.value);
                  }}
                  className="w-full rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light focus:border-cloistr-primary/50 focus:outline-none"
                />
              </div>
              {!isAllDay && (
                <div>
                  <label htmlFor="start-time" className="mb-1 block text-xs text-cloistr-light/60">
                    Start Time
                  </label>
                  <input
                    id="start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light focus:border-cloistr-primary/50 focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="end-date" className="mb-1 block text-xs text-cloistr-light/60">
                  End Date
                </label>
                <input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  className="w-full rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light focus:border-cloistr-primary/50 focus:outline-none"
                />
              </div>
              {!isAllDay && (
                <div>
                  <label htmlFor="end-time" className="mb-1 block text-xs text-cloistr-light/60">
                    End Time
                  </label>
                  <input
                    id="end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light focus:border-cloistr-primary/50 focus:outline-none"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Location */}
          <div>
            <label htmlFor="location" className="mb-1 block text-sm font-medium text-cloistr-light/80">
              Location (optional)
            </label>
            <input
              id="location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Add location"
              className="w-full rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light placeholder:text-cloistr-light/40 focus:border-cloistr-primary/50 focus:outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="mb-1 block text-sm font-medium text-cloistr-light/80">
              Description (optional)
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add description"
              rows={2}
              className="w-full resize-none rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light placeholder:text-cloistr-light/40 focus:border-cloistr-primary/50 focus:outline-none"
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="rounded-md border border-cloistr-light/20 px-4 py-2 text-sm font-medium text-cloistr-light hover:bg-cloistr-light/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="rounded-md bg-cloistr-primary px-4 py-2 text-sm font-medium text-white hover:bg-cloistr-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Format date for input[type="date"] value
 */
function formatDateInput(date: Date): string {
  return date.toISOString().split('T')[0];
}
