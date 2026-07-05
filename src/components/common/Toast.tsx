/**
 * @fileoverview Toast notification component
 * Displays floating notifications with auto-dismiss
 */

import { useEffect, useCallback, type ReactNode } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const TOAST_DURATION = 5000; // 5 seconds

const typeStyles = {
  info: 'border-cloistr-info/30 bg-cloistr-info/10',
  success: 'border-cloistr-success/30 bg-cloistr-success/10',
  warning: 'border-cloistr-warning/30 bg-cloistr-warning/10',
  error: 'border-cloistr-error/30 bg-cloistr-error/10',
};

const typeIcons: Record<string, ReactNode> = {
  info: (
    <svg className="h-5 w-5 text-cloistr-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  success: (
    <svg className="h-5 w-5 text-cloistr-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  warning: (
    <svg className="h-5 w-5 text-cloistr-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  error: (
    <svg className="h-5 w-5 text-cloistr-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

export function ToastContainer() {
  const notifications = useWorkspaceStore((state) => state.notifications);
  const dismissNotification = useWorkspaceStore((state) => state.dismissNotification);

  // Auto-dismiss toasts
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    notifications.forEach((notification) => {
      const timer = setTimeout(() => {
        dismissNotification(notification.id);
      }, TOAST_DURATION);
      timers.push(timer);
    });

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [notifications, dismissNotification]);

  if (notifications.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {notifications.slice(0, 5).map((notification) => (
        <Toast
          key={notification.id}
          id={notification.id}
          type={notification.type}
          title={notification.title}
          message={notification.message}
          onDismiss={dismissNotification}
        />
      ))}
    </div>
  );
}

interface ToastProps {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  onDismiss: (id: string) => void;
}

function Toast({ id, type, title, message, onDismiss }: ToastProps) {
  const handleDismiss = useCallback(() => {
    onDismiss(id);
  }, [id, onDismiss]);

  return (
    <div
      className={`flex min-w-[300px] max-w-md items-start gap-3 rounded-lg border p-4 shadow-lg ${typeStyles[type]}`}
      role="alert"
    >
      <div className="flex-shrink-0">{typeIcons[type]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-cloistr-light">{title}</p>
        {message && (
          <p className="mt-1 text-sm text-cloistr-light/70">{message}</p>
        )}
      </div>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
        aria-label="Dismiss notification"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// Helper hook to show toasts
export function useToast() {
  const addNotification = useWorkspaceStore((state) => state.addNotification);

  const toast = useCallback(
    (type: 'info' | 'success' | 'warning' | 'error', title: string, message?: string) => {
      addNotification({
        id: `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type,
        title,
        message,
        createdAt: new Date(),
        read: false,
      });
    },
    [addNotification]
  );

  return {
    info: (title: string, message?: string) => toast('info', title, message),
    success: (title: string, message?: string) => toast('success', title, message),
    warning: (title: string, message?: string) => toast('warning', title, message),
    error: (title: string, message?: string) => toast('error', title, message),
  };
}
