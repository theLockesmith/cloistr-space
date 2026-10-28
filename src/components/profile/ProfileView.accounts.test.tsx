/**
 * @fileoverview The relay-auth setting belongs to the signed-in user, not the browser.
 *
 * NdkService is built once and outlives account switches. On a shared browser,
 * account A switching authentication off must not reach account B: not B's
 * checkbox, not B's feed, and not the live policy B's session runs under.
 *
 * Runs the real NdkProvider and auth store, because the provider is what has to
 * apply each user's value when the pubkey changes.
 */

import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { useEffect } from 'react';
import { NdkProvider, useNdk, type NdkService } from '@/services/nostr';
import * as authSetting from '@/services/nostr/authSetting';
import { RelayAuthOffNotice } from '@/components/social/RelayAuthOffNotice';
import { ProfileView } from './ProfileView';

// Not signed in as far as the provider's connect logic goes, so nothing dials out.
vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ signer: null, isAuthenticated: false }),
}));

const profileState = vi.hoisted(() => ({ profile: {}, relays: [], relayListRead: 'found', existing: { status: 'found' } }));
vi.mock('@/services/profile', () => ({
  useProfile: () => ({
    ...profileState,
    isLoading: false,
    isSaving: false,
    error: null,
    reload: vi.fn(),
    saveProfile: vi.fn(),
    saveRelays: vi.fn(),
  }),
}));

const ALICE = 'a'.repeat(64);

// Optional so these tests still run, and fail on their assertions, against code
// that predates the in-session copy.
const forgetSession = () => authSetting.resetRelayAuthSessionForTests?.();
const BOB = 'b'.repeat(64);

// The live service, captured from context so tests can read the real policy.
const probe: { service: NdkService | null } = { service: null };

function PolicyProbe() {
  const { service } = useNdk();
  useEffect(() => {
    probe.service = service;
  }, [service]);
  return null;
}

function livePolicyEnabled(): boolean {
  if (!probe.service) throw new Error('service not ready');
  return probe.service.getAuthPolicy().isEnabled();
}

const signInAs = (pubkey: string | null) =>
  act(() => {
    useAuthStore.setState({ pubkey });
  });

const authBox = () => screen.getByRole('checkbox', { name: /let relays verify who you are/i });
const missingNotice = () => screen.queryByText(/some posts may be missing/i);

async function renderApp() {
  render(
    <MemoryRouter>
      <NdkProvider>
        <PolicyProbe />
        <RelayAuthOffNotice />
        <ProfileView />
      </NdkProvider>
    </MemoryRouter>
  );
  // The provider hands its service over a microtask after first render.
  await act(async () => {});
}

describe('relay-auth setting with two accounts on one browser', () => {
  beforeEach(() => {
    localStorage.clear();
    forgetSession();
    useAuthStore.setState({ pubkey: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not hand one account's 'off' to the next, and restores it on return", async () => {
    signInAs(ALICE);
    await renderApp();
    await userEvent.click(authBox());
    expect(authBox()).not.toBeChecked();
    expect(livePolicyEnabled()).toBe(false);
    expect(missingNotice()).not.toBeNull();

    signInAs(null);
    signInAs(BOB);
    expect(authBox()).toBeChecked();
    expect(livePolicyEnabled()).toBe(true);
    expect(missingNotice()).toBeNull();

    signInAs(null);
    signInAs(ALICE);
    expect(authBox()).not.toBeChecked();
    expect(livePolicyEnabled()).toBe(false);
    expect(missingNotice()).not.toBeNull();
  });

  it('uses the default while nobody is signed in', async () => {
    signInAs(ALICE);
    await renderApp();
    await userEvent.click(authBox());

    signInAs(null);
    expect(livePolicyEnabled()).toBe(true);
    expect(missingNotice()).toBeNull();
  });

  it("applies a returning user's saved 'off' after a reload, before they touch anything", async () => {
    signInAs(ALICE);
    await renderApp();
    await userEvent.click(authBox());
    cleanup();

    // Reload: memory is gone, the service is rebuilt with nobody signed in,
    // then the session restores.
    forgetSession();
    useAuthStore.setState({ pubkey: null });
    await renderApp();
    signInAs(ALICE);
    expect(authBox()).not.toBeChecked();
    expect(livePolicyEnabled()).toBe(false);
  });
});
