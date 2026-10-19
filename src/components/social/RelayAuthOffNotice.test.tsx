/**
 * @fileoverview The feed says posts may be missing exactly while the signed-in user has relay auth off.
 */

import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import * as authSetting from '@/services/nostr/authSetting';
import { RelayAuthOffNotice } from './RelayAuthOffNotice';

const ALICE = 'a'.repeat(64);

// Optional so these tests still run, and fail on their assertions, against code
// that predates the in-session copy.
const forgetSession = () => authSetting.resetRelayAuthSessionForTests?.();

const renderNotice = () =>
  render(
    <MemoryRouter>
      <RelayAuthOffNotice />
    </MemoryRouter>
  );

describe('RelayAuthOffNotice', () => {
  beforeEach(() => {
    localStorage.clear();
    forgetSession();
    useAuthStore.setState({ pubkey: ALICE });
  });

  afterEach(() => {
    cleanup();
  });

  it('says nothing while relay auth is on', () => {
    renderNotice();
    expect(screen.queryByText(/some posts may be missing/i)).toBeNull();
  });

  it('warns, and links to the setting, while relay auth is off', () => {
    authSetting.saveRelayAuthEnabled(ALICE, false);
    renderNotice();
    expect(screen.getByRole('status')).toHaveTextContent(/some posts may be missing/i);
    expect(screen.getByRole('link', { name: /change this in profile/i })).toHaveAttribute(
      'href',
      '/profile'
    );
  });

  it('appears and disappears as the setting changes, without a remount', () => {
    renderNotice();
    act(() => {
      authSetting.saveRelayAuthEnabled(ALICE, false);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => {
      authSetting.saveRelayAuthEnabled(ALICE, true);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
