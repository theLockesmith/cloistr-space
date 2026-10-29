/**
 * @fileoverview The relay list cannot be saved over until it has been read.
 *
 * kind:10002 replaces the user's relay list in every Nostr app, and the page's
 * draft starts empty. Before the read settles, or after it fails, a save would
 * publish only what was typed here. useProfile refuses such a save; this pins
 * that the page does not offer it, and does not call an unread list empty.
 */

import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, afterEach } from 'vitest';
import { NdkProvider } from '@/services/nostr';
import { ProfileView } from './ProfileView';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ signer: null, isAuthenticated: false }),
}));

// Stable references: ProfileView re-seeds its drafts whenever these change identity.
const profileState = vi.hoisted(() => ({
  profile: {},
  relays: [] as { url: string; read: boolean; write: boolean }[],
  relayListRead: null as 'found' | 'absent' | 'unreadable' | null,
  existing: { status: 'found' },
}));
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

function mount(read: typeof profileState.relayListRead) {
  profileState.relayListRead = read;
  render(
    <MemoryRouter>
      <NdkProvider>
        <ProfileView />
      </NdkProvider>
    </MemoryRouter>
  );
}

const saveButton = () => screen.getByRole('button', { name: /save relay list/i });
const emptyNotice = () => screen.queryByText(/no relays listed yet/i);

afterEach(cleanup);

describe('ProfileView relay list guard', () => {
  it('does not offer a save, or call the list empty, while the read is in flight', () => {
    mount(null);
    expect(saveButton()).toBeDisabled();
    expect(emptyNotice()).toBeNull();
  });

  it('says it could not read the list, rather than that there is none', () => {
    mount('unreadable');
    expect(saveButton()).toBeDisabled();
    expect(emptyNotice()).toBeNull();
    expect(screen.getByText(/could not read your current relay list/i)).toBeInTheDocument();
  });

  it('offers a save once relays answered with no list', () => {
    mount('absent');
    expect(saveButton()).toBeEnabled();
    expect(emptyNotice()).not.toBeNull();
  });
});
