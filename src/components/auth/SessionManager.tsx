/**
 * @fileoverview Session manager component
 * Combines activity tracking, timeout warnings, and relay reconnection.
 */

import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import { useNdk } from '@/services/nostr';
import { SessionTimeoutWarning } from './SessionTimeoutWarning';

/**
 * Manages session lifecycle: activity tracking, timeout warnings, and relay
 * reconnection on tab visibility change.
 *
 * Must be rendered inside AuthProvider, NdkProvider, and Router.
 *
 * PART 4 — visibilitychange reconnect
 *
 * When a mobile browser comes back from the background every open tab wakes at
 * the same moment, and sockets that were idle during the suspension are often
 * dead. Without an explicit reconnect the relay pool appears connected (the
 * status has not been updated yet) but drops all messages silently.
 *
 * Calling reconnect() on visibilitychange forces the NDK pool to re-establish
 * its sockets. It is safe to call unconditionally: NdkProvider's reconnect
 * calls service.disconnect() then service.connect(), and NdkService.connect()
 * is idempotent. The extra connect attempt on a healthy connection costs one
 * relay round-trip and nothing else.
 */
export function SessionManager() {
  const navigate = useNavigate();
  const { reconnect } = useNdk();

  // Track user activity to keep session alive
  useActivityTracker();

  // Part 4: reconnect relay sockets when the tab becomes visible again.
  // Note: useActivityTracker already listens to visibilitychange for activity
  // tracking; that listener calls updateActivity, which is orthogonal to this
  // one which calls reconnect. Two listeners on the same event is correct here.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reconnect().catch((err) => {
          console.warn('[SessionManager] Relay reconnect on visibilitychange failed:', err);
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [reconnect]);

  // Redirect to login when session genuinely expires
  const handleSessionExpired = useCallback(() => {
    navigate('/login', { replace: true });
  }, [navigate]);

  return <SessionTimeoutWarning onSessionExpired={handleSessionExpired} />;
}
