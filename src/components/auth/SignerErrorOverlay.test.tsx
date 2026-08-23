/**
 * Behavioral tests for SignerErrorOverlay.
 *
 * These tests verify the core product invariant: a signer connectivity failure
 * surfaces the recovery screen, never a login prompt. All assertions are
 * source-level (jsdom, no real relay) — but the code path they exercise is the
 * same path a browser follows, because the component reads signerError from
 * AuthProvider context and renders SignerRecovery from @cloistr/ui.
 *
 * Code path traced below for the human reader:
 *
 *   1. AuthProvider.signEvent wraps with withSignerRetry.
 *   2. withSignerRetry rethrows after retry exhaustion, then signEvent catches
 *      and calls setSignerError(err), which sets signerError in context.
 *   3. SignerErrorOverlay reads signerError from useAuth().
 *   4. When signerError !== null the overlay renders SignerRecovery.
 *   5. SignerRecovery always renders "You are still signed in." (asserted by
 *      @cloistr/ui's own tests; we rely on the text being present).
 *   6. SignerRecovery never renders a sign-in / password / credential prompt
 *      (also asserted by @cloistr/ui; we re-assert the absence here because
 *      the most tempting future edit is to add one for a "stuck" user).
 *
 *   Session restore path (the primary bug):
 *   1. restoreSession catches connectNip46 throwing CONNECTION_FAILED.
 *   2. classifySignerError → 'retryable'. persistedPubkey is set.
 *   3. storeLogin(persistedPubkey, ...) → isAuthenticated stays true.
 *   4. setSignerError(err) → signerError is set.
 *   5. AuthGuard passes (isAuthenticated = true); SignerErrorOverlay fires.
 *   6. User sees recovery screen, not the login page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SignerErrorOverlay } from './SignerErrorOverlay';

// ---------------------------------------------------------------------------
// Module mocks — must precede any import of the mocked modules.
// ---------------------------------------------------------------------------

const mockClearSignerError = vi.fn();
const mockRetrySignerConnection = vi.fn().mockResolvedValue(undefined);
const mockReconnect = vi.fn().mockResolvedValue(undefined);

// The signerError value injected by each test case.
let mockSignerError: unknown = null;

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    signerError: mockSignerError,
    clearSignerError: mockClearSignerError,
    retrySignerConnection: mockRetrySignerConnection,
    // Other context values not needed by SignerErrorOverlay
    pubkey: 'abc123',
    isAuthenticated: true,
    isLoading: false,
    error: null,
    signer: null,
    nip07Available: false,
    loginNip07: vi.fn(),
    loginNip46: vi.fn(),
    logout: vi.fn(),
    signEvent: vi.fn(),
  }),
}));

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({
    reconnect: mockReconnect,
    isConnected: false,
    isConnecting: false,
    relayStatuses: new Map(),
    service: null,
    subscribe: null,
    fetchEvents: null,
    createEvent: vi.fn(),
    publish: null,
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SignerErrorOverlay', () => {
  beforeEach(() => {
    mockSignerError = null;
    vi.clearAllMocks();
  });

  it('renders nothing when signerError is null', () => {
    mockSignerError = null;
    const { container } = render(<SignerErrorOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the recovery screen on a retryable error', () => {
    mockSignerError = Object.assign(new Error('relay down'), { code: 'CONNECTION_FAILED' });
    render(<SignerErrorOverlay />);

    // SignerRecovery from @cloistr/ui must be present
    expect(screen.getByRole('alert')).toBeTruthy();

    // The key copy that confirms the session is intact
    expect(screen.getByText('You are still signed in.')).toBeTruthy();
  });

  it('shows the recovery screen on a timeout (needs-user) error', () => {
    mockSignerError = Object.assign(new Error('timed out'), { code: 'TIMEOUT' });
    render(<SignerErrorOverlay />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('You are still signed in.')).toBeTruthy();
  });

  it('shows the recovery screen on a terminal error (user said no)', () => {
    mockSignerError = Object.assign(new Error('declined'), { code: 'CANCELLED' });
    render(<SignerErrorOverlay />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('You are still signed in.')).toBeTruthy();
  });

  it('NEVER shows a sign-in or credential prompt on any error kind', () => {
    for (const code of ['CONNECTION_FAILED', 'TIMEOUT', 'CANCELLED']) {
      mockSignerError = Object.assign(new Error('error'), { code });
      const { unmount } = render(<SignerErrorOverlay />);

      // These strings would indicate the component is telling the user to
      // authenticate again, which is the bug we are preventing.
      const body = document.body.textContent ?? '';
      const lowered = body.toLowerCase();
      expect(lowered).not.toContain('sign in');
      expect(lowered).not.toContain('log in');
      expect(lowered).not.toContain('password');
      expect(lowered).not.toContain('bunker url');

      unmount();
    }
  });

  it('calls clearSignerError when Go back is clicked', () => {
    mockSignerError = Object.assign(new Error('relay down'), { code: 'CONNECTION_FAILED' });
    render(<SignerErrorOverlay />);

    fireEvent.click(screen.getByText('Go back'));
    expect(mockClearSignerError).toHaveBeenCalledTimes(1);
  });

  it('calls reconnect and retrySignerConnection when Try again is clicked', async () => {
    mockSignerError = Object.assign(new Error('relay down'), { code: 'CONNECTION_FAILED' });
    render(<SignerErrorOverlay />);

    await act(async () => {
      fireEvent.click(screen.getByText('Try again'));
    });

    expect(mockReconnect).toHaveBeenCalledTimes(1);
    expect(mockRetrySignerConnection).toHaveBeenCalledTimes(1);
  });
});
