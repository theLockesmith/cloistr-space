/**
 * @fileoverview The relay-auth privacy setting has to survive a reload.
 *
 * Each "page load" below mounts a fresh NdkProvider, which builds a fresh
 * NdkService, and forgets in-memory state -- which is what a reload does.
 * Before the setting was saved, switching it off lasted only until the next
 * load: the new service started with authentication back on, and Profile showed
 * the box ticked again.
 *
 * Account switching on a shared browser is covered in ProfileView.accounts.test.tsx.
 */

import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { useEffect } from 'react';
import { NdkProvider, useNdk, type NdkService } from '@/services/nostr';
import * as authSetting from '@/services/nostr/authSetting';
import { ProfileView } from './ProfileView';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ signer: null, isAuthenticated: false }),
}));

// Stable references: ProfileView re-seeds its drafts whenever these change identity.
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

const authBox = () => screen.getByRole('checkbox', { name: /let relays verify who you are/i });

function mount() {
  render(
    <MemoryRouter>
      <NdkProvider>
        <PolicyProbe />
        <ProfileView />
      </NdkProvider>
    </MemoryRouter>
  );
}

/** A page load: memory gone, new provider and service, the signed-in session restored. */
async function loadPage() {
  cleanup();
  forgetSession();
  mount();
  // The provider hands its service over a microtask after first render.
  await act(async () => {});
}

describe('relay-auth setting across reloads', () => {
  beforeEach(() => {
    localStorage.clear();
    forgetSession();
    useAuthStore.setState({ pubkey: ALICE });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('defaults to on', async () => {
    await loadPage();
    expect(authBox()).toBeChecked();
    expect(livePolicyEnabled()).toBe(true);
  });

  it('stays off after a reload once the user switches it off', async () => {
    await loadPage();
    await userEvent.click(authBox());
    expect(livePolicyEnabled()).toBe(false);

    await loadPage();
    expect(authBox()).not.toBeChecked();
    expect(livePolicyEnabled()).toBe(false);
  });

  it('comes back on after a reload once the user switches it back on', async () => {
    await loadPage();
    await userEvent.click(authBox());
    await userEvent.click(authBox());

    await loadPage();
    expect(authBox()).toBeChecked();
    expect(livePolicyEnabled()).toBe(true);
  });

  it('applies a click made before the service exists once it arrives', async () => {
    cleanup();
    forgetSession();
    // No microtask flush: the provider has not handed over its service yet.
    mount();
    await userEvent.click(authBox());
    await act(async () => {});

    expect(authBox()).not.toBeChecked();
    expect(livePolicyEnabled()).toBe(false);
  });

  it('keeps the choice for the session, and says it will not last, when storage refuses it', async () => {
    await loadPage();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });

    await userEvent.click(authBox());
    expect(screen.getByRole('alert')).toHaveTextContent(/resets when you reload/i);
    expect(authBox()).not.toBeChecked();
    expect(livePolicyEnabled()).toBe(false);

    await userEvent.click(authBox());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
