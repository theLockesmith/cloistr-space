/**
 * @fileoverview Tests for the login page's header control and loading overlay.
 *
 * Two operator-reported regressions, both on the go-live path:
 *
 *  1. The Sign In button appears in the page body but NOT in the header. Every
 *     other app in the suite offers it there, so its absence reads as a broken
 *     page rather than a considered omission.
 *
 *  2. The NIP-46 flow shows a raw nostrconnect artifact instead of a branded
 *     "signing you in" screen. The page's loading state was an EARLY RETURN
 *     above the modal, so the instant a login began the modal was unmounted --
 *     taking any in-flight connection state with it -- and remounted fresh when
 *     loading settled.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Header } from '@cloistr/ui/components';
import { AuthProvider } from '@cloistr/auth';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const source = readFileSync(join(__dirname, 'LoginPage.tsx'), 'utf8');

function renderHeader(auth: Record<string, unknown>) {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Header activeServiceId="space" auth={auth as never} />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('login page header', () => {
  it('renders a Sign In control when onSignIn is supplied', () => {
    // The real Header, not a stub: a hand-rolled fixture would pass without
    // exercising the branch that actually returns null.
    renderHeader({ authenticated: false, onSignIn: vi.fn() });

    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('invokes the handler when clicked', () => {
    // A rendered-but-inert button looks identical to a working one.
    const onSignIn = vi.fn();
    renderHeader({ authenticated: false, onSignIn });

    screen.getByRole('button', { name: /sign in/i }).click();

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when onSignIn is omitted', () => {
    // Pins the SHARED behaviour that caused this, so an upstream "fix" that
    // removed the branch would fail here rather than silently making the
    // Space-side change redundant.
    renderHeader({ authenticated: false });

    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });
});

describe('login page loading state', () => {
  it('does not early-return on isLoading', () => {
    // Source-level, because the failure is a component being UNMOUNTED
    // mid-flow -- observable only across a real NIP-46 round trip, which no
    // unit test here can drive. What is checkable is that the loading branch
    // never again short-circuits above the modal.
    expect(source).not.toMatch(/if\s*\(isLoading\)\s*\{\s*return/);
  });

  it('renders the modal and the overlay from the same return', () => {
    // Both must be present in one tree. If the overlay ever moves above the
    // modal again, the modal unmounts the moment a login starts.
    const body = source.slice(source.indexOf('return ('));

    expect(body).toContain('<LoginModal');
    expect(body).toContain('isLoading &&');
    expect(body.indexOf('<LoginModal')).toBeLessThan(body.indexOf('isLoading &&'));
  });

  it('passes onSignIn to the header', () => {
    expect(source).toMatch(/onSignIn:\s*\(\)\s*=>\s*setModalOpen\(true\)/);
  });
});
