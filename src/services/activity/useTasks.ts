/**
 * @fileoverview Tasks hook using NDK subscriptions
 * Subscribes to kind:31990 (addressable task events)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { useNdk, type NDKEvent } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { Task, WidgetState } from '@/types/activity';
import { TASK_KIND } from '@/types/activity';

/** Maximum tasks to display */
const MAX_TASKS = 20;

/** Parse a kind:31990 event into Task */
function parseTaskEvent(event: NDKEvent): Task | null {
  const tags = event.tags;

  // Required: d-tag identifier
  const dTag = tags.find((t) => t[0] === 'd');
  if (!dTag?.[1]) return null;

  // Title from 'title' tag or first line of content
  const titleTag = tags.find((t) => t[0] === 'title');
  const title = titleTag?.[1] || event.content.split('\n')[0] || 'Untitled task';

  // Description from 'description' tag or content
  const descTag = tags.find((t) => t[0] === 'description');
  const description = descTag?.[1] || (titleTag ? event.content : undefined);

  // Status
  const statusTag = tags.find((t) => t[0] === 'status');
  const completed = statusTag?.[1] === 'completed' || statusTag?.[1] === 'done';

  // Priority
  const priorityTag = tags.find((t) => t[0] === 'priority');
  let priority: Task['priority'] = 'medium';
  if (priorityTag?.[1] === 'high' || priorityTag?.[1] === '1') priority = 'high';
  if (priorityTag?.[1] === 'low' || priorityTag?.[1] === '3') priority = 'low';

  // Due date
  const dueTag = tags.find((t) => t[0] === 'due');
  const dueDate = dueTag?.[1] ? parseInt(dueTag[1], 10) : undefined;

  // Group association
  const groupTag = tags.find((t) => t[0] === 'h');
  const groupId = groupTag?.[1];

  // Labels (t tags)
  const labels = tags.filter((t) => t[0] === 't').map((t) => t[1]);

  return {
    id: event.id,
    pubkey: event.pubkey,
    identifier: dTag[1],
    title,
    description,
    completed,
    priority,
    dueDate,
    groupId,
    labels,
    createdAt: event.created_at || Math.floor(Date.now() / 1000),
    updatedAt: event.created_at || Math.floor(Date.now() / 1000),
  };
}

/** Due date filter options */
export type DueDateFilter = 'all' | 'today' | 'week' | 'overdue' | 'no-date';

interface UseTasksOptions {
  /** Limit number of tasks */
  limit?: number;
  /** Filter by group */
  groupId?: string;
  /** Show completed tasks */
  showCompleted?: boolean;
  /** Filter by due date */
  dueDateFilter?: DueDateFilter;
  /** Auto-subscribe on mount */
  autoSubscribe?: boolean;
}

interface UseTasksReturn extends WidgetState<Task> {
  refresh: () => void;
  toggleTask: (identifier: string) => Promise<void>;
  createTask: (task: Omit<Task, 'id' | 'pubkey' | 'createdAt' | 'updatedAt'>) => Promise<void>;
}

/**
 * Hook for subscribing to tasks
 * Returns tasks sorted by priority then due date
 */
export function useTasks(options: UseTasksOptions = {}): UseTasksReturn {
  const { limit = MAX_TASKS, groupId, showCompleted = true, dueDateFilter = 'all', autoSubscribe = true } = options;
  const { subscribe, publish, createEvent, isConnected } = useNdk();
  const { pubkey, isAuthenticated } = useAuthStore();

  const [state, setState] = useState<WidgetState<Task>>({
    items: [],
    isLoading: true,
    error: null,
    lastUpdated: null,
  });

  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  // Map by d-tag identifier for addressable event deduplication
  const tasksMapRef = useRef<Map<string, Task>>(new Map());

  const filterByDueDate = useCallback((task: Task): boolean => {
    if (dueDateFilter === 'all') return true;

    const now = Math.floor(Date.now() / 1000);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayStart = Math.floor(startOfToday.getTime() / 1000);
    const todayEnd = todayStart + 86400; // 24 hours
    const weekEnd = todayStart + 7 * 86400; // 7 days

    switch (dueDateFilter) {
      case 'today':
        return task.dueDate !== undefined && task.dueDate >= todayStart && task.dueDate < todayEnd;
      case 'week':
        return task.dueDate !== undefined && task.dueDate >= todayStart && task.dueDate < weekEnd;
      case 'overdue':
        return task.dueDate !== undefined && task.dueDate < now && !task.completed;
      case 'no-date':
        return task.dueDate === undefined;
      default:
        return true;
    }
  }, [dueDateFilter]);

  const sortTasks = useCallback((tasks: Task[]): Task[] => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };

    return tasks
      .filter((t) => showCompleted || !t.completed)
      .filter(filterByDueDate)
      .sort((a, b) => {
        // Incomplete first
        if (a.completed !== b.completed) {
          return a.completed ? 1 : -1;
        }
        // Then by priority
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        // Then by due date (earlier first, no due date last)
        if (a.dueDate && b.dueDate) return a.dueDate - b.dueDate;
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        // Finally by creation time
        return b.createdAt - a.createdAt;
      })
      .slice(0, limit);
  }, [limit, showCompleted, filterByDueDate]);

  const startSubscription = useCallback(() => {
    if (!subscribe || !isConnected || !pubkey) {
      setState((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    // Clean up existing subscription
    subscriptionRef.current?.unsubscribe();
    tasksMapRef.current.clear();

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    // Build filter for user's tasks
    const filter: NDKFilter = {
      kinds: [TASK_KIND as number],
      authors: [pubkey],
    };

    // Add group filter if specified
    if (groupId) {
      filter['#h'] = [groupId];
    }

    try {
      const subscription = subscribe([filter], { closeOnEose: false });

      subscription.on('event', (event: NDKEvent) => {
        const task = parseTaskEvent(event);
        if (!task) return;

        // Use d-tag as key for addressable events (newer overwrites older)
        const existing = tasksMapRef.current.get(task.identifier);
        if (!existing || task.updatedAt >= existing.updatedAt) {
          tasksMapRef.current.set(task.identifier, task);
        }

        setState({
          items: sortTasks(Array.from(tasksMapRef.current.values())),
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
        error: err instanceof Error ? err.message : 'Failed to fetch tasks',
        lastUpdated: Date.now(),
      });
    }
  }, [subscribe, isConnected, pubkey, groupId, sortTasks]);

  // Toggle task completion
  const toggleTask = useCallback(async (identifier: string) => {
    if (!publish || !createEvent || !pubkey) return;

    const task = tasksMapRef.current.get(identifier);
    if (!task) return;

    const newCompleted = !task.completed;

    // Build updated event
    const tags: string[][] = [
      ['d', identifier],
      ['title', task.title],
      ['status', newCompleted ? 'completed' : 'pending'],
      ['priority', task.priority],
    ];

    if (task.description) tags.push(['description', task.description]);
    if (task.dueDate) tags.push(['due', task.dueDate.toString()]);
    if (task.groupId) tags.push(['h', task.groupId]);
    task.labels.forEach((label) => tags.push(['t', label]));

    try {
      const event = createEvent();
      if (!event) throw new Error('Failed to create event');

      event.kind = TASK_KIND;
      event.content = task.description || '';
      event.tags = tags;

      await publish(event);

      // Optimistically update local state
      const updatedTask = { ...task, completed: newCompleted, updatedAt: Math.floor(Date.now() / 1000) };
      tasksMapRef.current.set(identifier, updatedTask);
      setState((prev) => ({
        ...prev,
        items: sortTasks(Array.from(tasksMapRef.current.values())),
      }));
    } catch (err) {
      console.error('Failed to toggle task:', err);
    }
  }, [publish, createEvent, pubkey, sortTasks]);

  // Create new task
  const newTask = useCallback(async (task: Omit<Task, 'id' | 'pubkey' | 'createdAt' | 'updatedAt'>) => {
    if (!publish || !createEvent || !pubkey) return;

    const tags: string[][] = [
      ['d', task.identifier],
      ['title', task.title],
      ['status', task.completed ? 'completed' : 'pending'],
      ['priority', task.priority],
    ];

    if (task.description) tags.push(['description', task.description]);
    if (task.dueDate) tags.push(['due', task.dueDate.toString()]);
    if (task.groupId) tags.push(['h', task.groupId]);
    task.labels.forEach((label) => tags.push(['t', label]));

    try {
      const event = createEvent();
      if (!event) throw new Error('Failed to create event');

      event.kind = TASK_KIND;
      event.content = task.description || '';
      event.tags = tags;

      await publish(event);
      // Subscription will pick up the new task
    } catch (err) {
      console.error('Failed to create task:', err);
      throw err;
    }
  }, [publish, createEvent, pubkey]);

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

  return {
    ...state,
    refresh: startSubscription,
    toggleTask,
    createTask: newTask,
  };
}
