/**
 * @fileoverview Session timeout warning modal
 * Displays when session is about to expire, allows user to extend
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuthStore, SESSION_TIMEOUT_MS, SESSION_WARNING_MS } from '@/stores/authStore';
import { useAuth } from './AuthProvider';

interface SessionTimeoutWarningProps {
  /** Called when session expires and user is logged out */
  onSessionExpired?: () => void;
}

/**
 * Session timeout warning modal
 * Shows when session is about to expire
 */
export function SessionTimeoutWarning({ onSessionExpired }: SessionTimeoutWarningProps) {
  const { logout } = useAuth();
  const { isAuthenticated, sessionExpiresAt, extendSession } = useAuthStore();
  const [showWarning, setShowWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const mountedRef = useRef(true);

  // Check session status periodically
  useEffect(() => {
    mountedRef.current = true;

    // Early exit without state updates - initial state handles this
    if (!isAuthenticated || !sessionExpiresAt) {
      return;
    }

    const checkSession = () => {
      if (!mountedRef.current) return;

      const now = Date.now();
      const remaining = sessionExpiresAt - now;

      if (remaining <= 0) {
        // Session expired
        setShowWarning(false);
        logout();
        onSessionExpired?.();
      } else if (remaining <= SESSION_WARNING_MS) {
        // Show warning
        setShowWarning(true);
        setTimeRemaining(Math.ceil(remaining / 1000));
      } else {
        setShowWarning(false);
      }
    };

    // Check immediately via timeout to avoid sync setState
    const immediateCheck = setTimeout(checkSession, 0);

    // Check every second
    const interval = setInterval(checkSession, 1000);

    return () => {
      mountedRef.current = false;
      clearTimeout(immediateCheck);
      clearInterval(interval);
    };
  }, [isAuthenticated, sessionExpiresAt, logout, onSessionExpired]);

  // Reset warning state when auth state changes
  useEffect(() => {
    if (!isAuthenticated || !sessionExpiresAt) {
      // Use timeout to avoid sync setState in effect
      const timeout = setTimeout(() => {
        setShowWarning(false);
        setTimeRemaining(0);
      }, 0);
      return () => clearTimeout(timeout);
    }
  }, [isAuthenticated, sessionExpiresAt]);

  const handleExtend = useCallback(() => {
    extendSession();
    setShowWarning(false);
  }, [extendSession]);

  const handleLogout = useCallback(() => {
    setShowWarning(false);
    logout();
  }, [logout]);

  if (!showWarning) {
    return null;
  }

  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const timeDisplay = minutes > 0
    ? `${minutes}:${seconds.toString().padStart(2, '0')}`
    : `${seconds}s`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 max-w-md rounded-lg border border-yellow-500/30 bg-cloistr-dark p-6 shadow-xl">
        {/* Warning icon */}
        <div className="mb-4 flex justify-center">
          <div className="rounded-full bg-yellow-500/20 p-3">
            <svg
              className="h-8 w-8 text-yellow-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        </div>

        {/* Content */}
        <h2 className="mb-2 text-center text-xl font-semibold text-cloistr-light">
          Session Expiring
        </h2>
        <p className="mb-4 text-center text-cloistr-light/70">
          Your session will expire in{' '}
          <span className="font-mono font-bold text-yellow-500">{timeDisplay}</span>
          {' '}due to inactivity.
        </p>

        {/* Session duration info */}
        <p className="mb-6 text-center text-sm text-cloistr-light/50">
          Sessions last {SESSION_TIMEOUT_MS / 60000} minutes. Click below to continue working.
        </p>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleLogout}
            className="flex-1 rounded-md border border-cloistr-light/20 px-4 py-2 text-sm font-medium text-cloistr-light/70 transition-colors hover:bg-cloistr-light/5"
          >
            Log out
          </button>
          <button
            onClick={handleExtend}
            className="flex-1 rounded-md bg-cloistr-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cloistr-primary/90"
          >
            Stay logged in
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact session indicator for showing remaining time
 * Use in header/sidebar when user is approaching timeout
 */
export function SessionIndicator() {
  const { isAuthenticated, sessionExpiresAt } = useAuthStore();
  const [showIndicator, setShowIndicator] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Early exit without state updates
    if (!isAuthenticated || !sessionExpiresAt) {
      return;
    }

    const checkSession = () => {
      if (!mountedRef.current) return;

      const now = Date.now();
      const remaining = sessionExpiresAt - now;

      // Show indicator when less than warning threshold
      if (remaining > 0 && remaining <= SESSION_WARNING_MS) {
        setShowIndicator(true);
        setTimeRemaining(Math.ceil(remaining / 1000));
      } else {
        setShowIndicator(false);
      }
    };

    // Check immediately via timeout to avoid sync setState
    const immediateCheck = setTimeout(checkSession, 0);
    const interval = setInterval(checkSession, 1000);

    return () => {
      mountedRef.current = false;
      clearTimeout(immediateCheck);
      clearInterval(interval);
    };
  }, [isAuthenticated, sessionExpiresAt]);

  // Reset indicator when auth state changes
  useEffect(() => {
    if (!isAuthenticated || !sessionExpiresAt) {
      const timeout = setTimeout(() => {
        setShowIndicator(false);
        setTimeRemaining(0);
      }, 0);
      return () => clearTimeout(timeout);
    }
  }, [isAuthenticated, sessionExpiresAt]);

  if (!showIndicator) {
    return null;
  }

  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;

  return (
    <div className="flex items-center gap-1.5 rounded-md bg-yellow-500/10 px-2 py-1 text-xs text-yellow-500">
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span className="font-mono">
        {minutes}:{seconds.toString().padStart(2, '0')}
      </span>
    </div>
  );
}
