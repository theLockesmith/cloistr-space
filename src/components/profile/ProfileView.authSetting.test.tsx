/**
 * @fileoverview The relay-auth privacy setting has to survive a reload.
 *
 * Each "page load" below builds a fresh NdkService, which is what a reload does.
 * Before the setting was saved, switching it off lasted only until the next
 * load: the new service started with authentication back on, and Profile showed
 * the box ticked again.
 */

import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NdkService } from '@/services/nostr/ndk';

let currentService: NdkService | null = null;

vi.mock('@/services/nostr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/nostr')>()),
  useNdk: () => ({ service: currentService }),
}));

// Stable references: ProfileView re-seeds its drafts whenever these change identity.
const profileState = vi.hoisted(() => ({ profile: {}, relays: [], existing: { status: 'found' } }));

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

const { ProfileView } = await import('./ProfileView');

/** What a page load does: a new service, then the view. */
function loadPage() {
  currentService = new NdkService({ autoConnect: false });
  return render(<ProfileView />);
}

const authBox = () => screen.getByRole('checkbox', { name: /let relays verify who you are/i });

describe('relay-auth setting across reloads', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    currentService = null;
  });

  it('defaults to on', () => {
    loadPage();
    expect(authBox()).toBeChecked();
    expect(currentService!.getAuthPolicy().isEnabled()).toBe(true);
  });

  it('stays off after a reload once the user switches it off', async () => {
    loadPage();
    await userEvent.click(authBox());
    expect(currentService!.getAuthPolicy().isEnabled()).toBe(false);

    cleanup();
    loadPage();

    expect(authBox()).not.toBeChecked();
    expect(currentService!.getAuthPolicy().isEnabled()).toBe(false);
  });

  it('comes back on after a reload once the user switches it back on', async () => {
    loadPage();
    await userEvent.click(authBox());
    await userEvent.click(authBox());

    cleanup();
    loadPage();

    expect(authBox()).toBeChecked();
    expect(currentService!.getAuthPolicy().isEnabled()).toBe(true);
  });

  it('shows the saved value when Profile renders before the service exists', async () => {
    loadPage();
    await userEvent.click(authBox());
    cleanup();

    // A deep-link reload straight to Profile: the provider hands the service
    // over a microtask after first render, so the view first sees null.
    currentService = null;
    render(<ProfileView />);

    expect(authBox()).not.toBeChecked();
  });

  it('applies a click made before the service exists once it arrives', async () => {
    // The provider builds the service from the saved value, then hands it over
    // a microtask later. A click in between changes the saved value, not the
    // already-built policy.
    const builtBeforeClick = new NdkService({ autoConnect: false });
    currentService = null;
    const { rerender } = render(<ProfileView />);

    await userEvent.click(authBox());
    expect(builtBeforeClick.getAuthPolicy().isEnabled()).toBe(true);

    currentService = builtBeforeClick;
    rerender(<ProfileView />);

    expect(authBox()).not.toBeChecked();
    expect(builtBeforeClick.getAuthPolicy().isEnabled()).toBe(false);
  });

  it('says so when the browser will not save the setting, and clears it once it does', async () => {
    loadPage();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });

    await userEvent.click(authBox());
    expect(screen.getByRole('alert')).toHaveTextContent(/resets when you reload/i);

    await userEvent.click(authBox());
    expect(screen.queryByRole('alert')).toBeNull();
    setItem.mockRestore();
  });
});
