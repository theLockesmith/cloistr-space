/**
 * @fileoverview Activity tracker hook for session management
 * Tracks user interactions and updates session activity timestamp
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';

/** Throttle activity updates to prevent excessive store writes */
const ACTIVITY_THROTTLE_MS = 30_000; // 30 seconds

/** Events that count as user activity */
const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'touchstart',
  'click',
] as const;

interface UseActivityTrackerOptions {
  /** Whether tracking is enabled (default: true when authenticated) */
  enabled?: boolean;
  /** Throttle interval in ms (default: 30000) */
  throttleMs?: number;
}

/**
 * Tracks user activity and updates session timestamp
 * Automatically handles throttling to prevent excessive updates
 */
export function useActivityTracker(options: UseActivityTrackerOptions = {}) {
  const { isAuthenticated, updateActivity } = useAuthStore();
  const { enabled = isAuthenticated, throttleMs = ACTIVITY_THROTTLE_MS } = options;

  // Initialize refs without impure function calls during render
  const lastActivityRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const initializedRef = useRef(false);

  const handleActivity = useCallback(() => {
    const now = Date.now();

    // Throttle updates
    if (now - lastActivityRef.current < throttleMs) {
      return;
    }

    lastActivityRef.current = now;

    // Use RAF to batch updates
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      updateActivity();
      rafIdRef.current = null;
    });
  }, [throttleMs, updateActivity]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Initialize the timestamp on first enable
    if (!initializedRef.current) {
      lastActivityRef.current = Date.now();
      initializedRef.current = true;
    }

    // Add event listeners
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    // Also track visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleActivity();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // Cleanup
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [enabled, handleActivity]);

  // Return manual trigger for programmatic updates
  return { triggerActivity: handleActivity };
}
