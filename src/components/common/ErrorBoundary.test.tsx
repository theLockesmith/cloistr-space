import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ErrorBoundary, CompactErrorFallback, FullPageErrorFallback } from './ErrorBoundary';

// Test component that throws an error when triggerError prop is true
function ProblematicComponent({ triggerError = false, errorMessage = 'Test error' }: { triggerError?: boolean; errorMessage?: string }) {
  if (triggerError) {
    throw new Error(errorMessage);
  }
  return <div>Working component</div>;
}

// Test component for reset functionality - starts without error
function ToggleErrorComponent() {
  const [hasError, setHasError] = React.useState(false);

  return (
    <div>
      <button onClick={() => setHasError(!hasError)}>Toggle Error</button>
      <ProblematicComponent triggerError={hasError} />
    </div>
  );
}


describe('ErrorBoundary', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Suppress console.error during tests to avoid noise
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('Normal rendering', () => {
    it('renders children when no error occurs', () => {
      render(
        <ErrorBoundary>
          <div data-testid="child">Working content</div>
        </ErrorBoundary>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
      expect(screen.getByText('Working content')).toBeInTheDocument();
    });

    it('passes through multiple children', () => {
      render(
        <ErrorBoundary>
          <div data-testid="child1">First child</div>
          <div data-testid="child2">Second child</div>
        </ErrorBoundary>
      );

      expect(screen.getByTestId('child1')).toBeInTheDocument();
      expect(screen.getByTestId('child2')).toBeInTheDocument();
    });
  });

  describe('Error catching behavior', () => {
    it('catches errors and shows default fallback UI', () => {
      render(
        <ErrorBoundary>
          <ProblematicComponent triggerError={true} />
        </ErrorBoundary>
      );

      expect(screen.queryByText('Working component')).not.toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('Test error')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('shows custom error message in default fallback', () => {
      const customErrorMessage = 'Custom error message';
      render(
        <ErrorBoundary>
          <ProblematicComponent triggerError={true} errorMessage={customErrorMessage} />
        </ErrorBoundary>
      );

      expect(screen.getByText(customErrorMessage)).toBeInTheDocument();
    });

    it('uses static fallback when provided', () => {
      const customFallback = <div data-testid="custom-fallback">Custom error UI</div>;

      render(
        <ErrorBoundary fallback={customFallback}>
          <ProblematicComponent triggerError={true} />
        </ErrorBoundary>
      );

      expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
      expect(screen.getByText('Custom error UI')).toBeInTheDocument();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });

    it('uses fallbackRender function when provided', () => {
      const fallbackRender = vi.fn(({ error, resetError }) => (
        <div>
          <p>Render function called</p>
          <p>Error: {error.message}</p>
          <button onClick={resetError}>Custom Reset</button>
        </div>
      ));

      render(
        <ErrorBoundary fallbackRender={fallbackRender}>
          <ProblematicComponent triggerError={true} errorMessage="Custom error" />
        </ErrorBoundary>
      );

      expect(fallbackRender).toHaveBeenCalledWith({
        error: expect.objectContaining({ message: 'Custom error' }),
        resetError: expect.any(Function),
      });
      expect(screen.getByText('Render function called')).toBeInTheDocument();
      expect(screen.getByText('Error: Custom error')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /custom reset/i })).toBeInTheDocument();
    });

    it('prioritizes fallbackRender over static fallback', () => {
      const staticFallback = <div>Static fallback</div>;
      const fallbackRender = () => <div>Render fallback</div>;

      render(
        <ErrorBoundary fallback={staticFallback} fallbackRender={fallbackRender}>
          <ProblematicComponent triggerError={true} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Render fallback')).toBeInTheDocument();
      expect(screen.queryByText('Static fallback')).not.toBeInTheDocument();
    });

    it('logs error to console with context', () => {
      const context = 'UserProfile';

      render(
        <ErrorBoundary context={context}>
          <ProblematicComponent triggerError={true} errorMessage="Test error" />
        </ErrorBoundary>
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        '[ErrorBoundary:UserProfile]',
        expect.objectContaining({ message: 'Test error' }),
        expect.any(Object)
      );
    });

    it('logs error to console without context', () => {
      render(
        <ErrorBoundary>
          <ProblematicComponent triggerError={true} />
        </ErrorBoundary>
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        '[ErrorBoundary]',
        expect.any(Error),
        expect.any(Object)
      );
    });

    it('calls onError callback when error occurs', () => {
      const onError = vi.fn();

      render(
        <ErrorBoundary onError={onError}>
          <ProblematicComponent triggerError={true} errorMessage="Callback test" />
        </ErrorBoundary>
      );

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Callback test' }),
        expect.objectContaining({
          componentStack: expect.any(String),
        })
      );
    });
  });

  describe('Reset functionality', () => {
    it('resets error boundary state when resetError is called', async () => {
      const user = userEvent.setup();
      let shouldThrow = true;

      function ConditionalErrorComponent() {
        if (shouldThrow) {
          throw new Error('Reset test error');
        }
        return <div>Component working after reset</div>;
      }

      const fallbackRender = ({ error, resetError }: { error: Error; resetError: () => void }) => (
        <div>
          <p data-testid="error-message">Error: {error.message}</p>
          <button
            onClick={() => {
              shouldThrow = false; // Stop throwing on next render
              resetError();
            }}
          >
            Reset Component
          </button>
        </div>
      );

      render(
        <ErrorBoundary fallbackRender={fallbackRender}>
          <ConditionalErrorComponent />
        </ErrorBoundary>
      );

      // Should show error UI initially
      expect(screen.getByTestId('error-message')).toHaveTextContent('Error: Reset test error');

      // Click reset button
      await user.click(screen.getByRole('button', { name: /reset component/i }));

      // Should show working component after reset
      expect(screen.queryByTestId('error-message')).not.toBeInTheDocument();
      expect(screen.getByText('Component working after reset')).toBeInTheDocument();
    });

    it('calls resetError and clears error state properly', async () => {
      const user = userEvent.setup();
      let hasBeenReset = false;

      // Mock component that only throws before reset
      function ResettableComponent() {
        if (!hasBeenReset) {
          throw new Error('Before reset error');
        }
        return <div>Successfully reset</div>;
      }

      const fallbackRender = ({ error, resetError }: { error: Error; resetError: () => void }) => (
        <div>
          <p>Fallback: {error.message}</p>
          <button
            onClick={() => {
              hasBeenReset = true;
              resetError();
            }}
          >
            Custom Reset
          </button>
        </div>
      );

      render(
        <ErrorBoundary fallbackRender={fallbackRender}>
          <ResettableComponent />
        </ErrorBoundary>
      );

      // Should show error initially
      expect(screen.getByText('Fallback: Before reset error')).toBeInTheDocument();

      // Reset the component
      await user.click(screen.getByRole('button', { name: /custom reset/i }));

      // Should render successfully after reset
      expect(screen.queryByText('Fallback: Before reset error')).not.toBeInTheDocument();
      expect(screen.getByText('Successfully reset')).toBeInTheDocument();
    });

    it('can handle repeated error/reset cycles', async () => {
      const user = userEvent.setup();

      render(
        <ErrorBoundary>
          <ToggleErrorComponent />
        </ErrorBoundary>
      );

      // Initially working
      expect(screen.getByText('Working component')).toBeInTheDocument();

      // Trigger error
      await user.click(screen.getByRole('button', { name: /toggle error/i }));
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      // Reset
      await user.click(screen.getByRole('button', { name: /try again/i }));
      expect(screen.getByText('Working component')).toBeInTheDocument();

      // Trigger error again
      await user.click(screen.getByRole('button', { name: /toggle error/i }));
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      // Reset again
      await user.click(screen.getByRole('button', { name: /try again/i }));
      expect(screen.getByText('Working component')).toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('handles error with empty message', () => {
      render(
        <ErrorBoundary>
          <ProblematicComponent triggerError={true} errorMessage="" />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
    });

    it('handles error without message property', () => {
      function ComponentWithCustomError(): React.JSX.Element {
        const error = new Error();
        error.message = '';
        throw error;
      }

      render(
        <ErrorBoundary>
          <ComponentWithCustomError />
        </ErrorBoundary>
      );

      expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
    });

    it('only catches errors from child components, not from error boundary itself', () => {
      // This test ensures the error boundary doesn't catch its own errors
      const ThrowingFallback = () => {
        throw new Error('Fallback error');
      };

      expect(() => {
        render(
          <ErrorBoundary fallbackRender={() => <ThrowingFallback />}>
            <ProblematicComponent triggerError={true} />
          </ErrorBoundary>
        );
      }).toThrow('Fallback error');
    });
  });
});

describe('CompactErrorFallback', () => {
  const mockError = new Error('Compact error test');
  const mockResetError = vi.fn();

  beforeEach(() => {
    mockResetError.mockClear();
  });

  it('renders compact error UI with default title', () => {
    render(<CompactErrorFallback error={mockError} resetError={mockResetError} />);

    expect(screen.getByText('Error loading content')).toBeInTheDocument();
    expect(screen.getByText('Compact error test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders compact error UI with custom title', () => {
    render(
      <CompactErrorFallback
        error={mockError}
        resetError={mockResetError}
        title="Widget failed to load"
      />
    );

    expect(screen.getByText('Widget failed to load')).toBeInTheDocument();
    expect(screen.getByText('Compact error test')).toBeInTheDocument();
  });

  it('calls resetError when retry button is clicked', async () => {
    const user = userEvent.setup();

    render(<CompactErrorFallback error={mockError} resetError={mockResetError} />);

    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(mockResetError).toHaveBeenCalledOnce();
  });
});

describe('FullPageErrorFallback', () => {
  const mockError = new Error('Full page error test');
  const mockResetError = vi.fn();

  beforeEach(() => {
    mockResetError.mockClear();
  });

  afterEach(() => {
    // Restore window.location.reload if it was mocked
    if ('mockRestore' in window.location.reload) {
      (window.location.reload as ReturnType<typeof vi.fn>).mockRestore();
    }
  });

  it('renders full-page error UI', () => {
    render(<FullPageErrorFallback error={mockError} resetError={mockResetError} />);

    expect(screen.getByRole('heading', { name: /application error/i })).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh page/i })).toBeInTheDocument();
  });

  it('shows error details in collapsible section', async () => {
    const errorWithStack = new Error('Error with stack');
    errorWithStack.stack = 'Error: Error with stack\n    at test.js:1:1';

    const user = userEvent.setup();

    render(<FullPageErrorFallback error={errorWithStack} resetError={mockResetError} />);

    // Error details should be hidden initially (details/summary behavior)
    const detailsElement = screen.getByText('Error details');
    expect(detailsElement).toBeInTheDocument();

    // Click to expand details
    await user.click(detailsElement);

    // Stack trace should be visible
    expect(screen.getByText(/Error: Error with stack/)).toBeInTheDocument();
    expect(screen.getByText(/at test.js:1:1/)).toBeInTheDocument();
  });

  it('shows error message when no stack trace available', async () => {
    const errorWithoutStack = new Error('Simple error message');
    delete errorWithoutStack.stack;

    const user = userEvent.setup();

    render(<FullPageErrorFallback error={errorWithoutStack} resetError={mockResetError} />);

    const detailsElement = screen.getByText('Error details');
    await user.click(detailsElement);

    expect(screen.getByText('Simple error message')).toBeInTheDocument();
  });

  it('calls resetError when try again button is clicked', async () => {
    const user = userEvent.setup();

    render(<FullPageErrorFallback error={mockError} resetError={mockResetError} />);

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(mockResetError).toHaveBeenCalledOnce();
  });

  it('calls window.location.reload when refresh page button is clicked', async () => {
    const user = userEvent.setup();
    const reloadSpy = vi.fn();

    // Mock window.location.reload
    Object.defineProperty(window, 'location', {
      value: { reload: reloadSpy },
      writable: true,
    });

    render(<FullPageErrorFallback error={mockError} resetError={mockResetError} />);

    await user.click(screen.getByRole('button', { name: /refresh page/i }));

    expect(reloadSpy).toHaveBeenCalledOnce();
  });
});