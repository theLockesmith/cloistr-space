/**
 * @fileoverview Error boundary components for graceful error handling
 * Catches JavaScript errors in child components and displays fallback UI
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback UI */
  fallback?: ReactNode;
  /** Fallback render function with error details */
  fallbackRender?: (props: { error: Error; resetError: () => void }) => ReactNode;
  /** Callback when error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Context name for error reporting */
  context?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary component that catches errors in child tree
 * Must be a class component per React requirements
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { onError, context } = this.props;

    // Log error with context
    console.error(`[ErrorBoundary${context ? `:${context}` : ''}]`, error, errorInfo);

    // Call custom error handler
    onError?.(error, errorInfo);
  }

  resetError = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback, fallbackRender } = this.props;

    if (hasError && error) {
      // Custom render function takes priority
      if (fallbackRender) {
        return fallbackRender({ error, resetError: this.resetError });
      }

      // Static fallback
      if (fallback) {
        return fallback;
      }

      // Default fallback
      return <DefaultErrorFallback error={error} resetError={this.resetError} />;
    }

    return children;
  }
}

/**
 * Default error fallback UI
 */
function DefaultErrorFallback({
  error,
  resetError,
}: {
  error: Error;
  resetError: () => void;
}) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-red-500/30 bg-red-500/5 p-6 text-center">
      <div className="mb-4 rounded-full bg-red-500/20 p-3">
        <svg
          className="h-6 w-6 text-red-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <h3 className="mb-2 text-lg font-medium text-cloistr-light">
        Something went wrong
      </h3>
      <p className="mb-4 max-w-md text-sm text-cloistr-light/60">
        {error.message || 'An unexpected error occurred'}
      </p>
      <button
        onClick={resetError}
        className="rounded-md bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/30"
      >
        Try again
      </button>
    </div>
  );
}

/**
 * Compact error fallback for widgets/cards
 */
export function CompactErrorFallback({
  error,
  resetError,
  title = 'Error loading content',
}: {
  error: Error;
  resetError: () => void;
  title?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
      <div className="flex items-center gap-3">
        <svg
          className="h-5 w-5 text-red-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div>
          <p className="text-sm font-medium text-cloistr-light">{title}</p>
          <p className="text-xs text-cloistr-light/40">{error.message}</p>
        </div>
      </div>
      <button
        onClick={resetError}
        className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
      >
        Retry
      </button>
    </div>
  );
}

/**
 * Full-page error fallback for critical errors
 */
export function FullPageErrorFallback({
  error,
  resetError,
}: {
  error: Error;
  resetError: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cloistr-dark p-6">
      <div className="max-w-md text-center">
        <div className="mb-6 inline-flex rounded-full bg-red-500/20 p-4">
          <svg
            className="h-12 w-12 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h1 className="mb-3 text-2xl font-bold text-cloistr-light">
          Application Error
        </h1>
        <p className="mb-6 text-cloistr-light/60">
          Something went wrong. Please try refreshing the page or contact support
          if the problem persists.
        </p>
        <details className="mb-6 rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4 text-left">
          <summary className="cursor-pointer text-sm font-medium text-cloistr-light/80">
            Error details
          </summary>
          <pre className="mt-2 overflow-auto text-xs text-red-400">
            {error.stack || error.message}
          </pre>
        </details>
        <div className="flex justify-center gap-4">
          <button
            onClick={resetError}
            className="rounded-md bg-cloistr-primary px-4 py-2 text-sm font-medium text-white hover:bg-cloistr-primary/90"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md border border-cloistr-light/20 px-4 py-2 text-sm font-medium text-cloistr-light hover:bg-cloistr-light/5"
          >
            Refresh page
          </button>
        </div>
      </div>
    </div>
  );
}
