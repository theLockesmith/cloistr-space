/**
 * @fileoverview Session manager component
 * Combines activity tracking and timeout warnings
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import { SessionTimeoutWarning } from './SessionTimeoutWarning';

/**
 * Manages session lifecycle: activity tracking and timeout warnings
 * Must be rendered inside AuthProvider and Router
 */
export function SessionManager() {
  const navigate = useNavigate();

  // Track user activity to keep session alive
  useActivityTracker();

  // Redirect to login when session expires
  const handleSessionExpired = useCallback(() => {
    navigate('/login', { replace: true });
  }, [navigate]);

  return <SessionTimeoutWarning onSessionExpired={handleSessionExpired} />;
}
