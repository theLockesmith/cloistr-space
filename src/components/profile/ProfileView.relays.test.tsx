/**
 * The relay editor must not offer a save that would replace the user's relay
 * list when that list was never read, and must not call an unread list empty.
 * useProfile.test.ts proves the hook refuses; this proves the form says so.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UseProfileReturn } from '@/services/profile';

let hookState: Partial<UseProfileReturn>;

// Stable identities: ProfileView re-seeds its drafts when these change, as the
// real hook only does on a new read.
const NO_FIELDS = {};
const NO_RELAYS: never[] = [];

vi.mock('@/services/profile', () => ({
  useProfile: () => ({
    profile: NO_FIELDS,
    relays: NO_RELAYS,
    existing: null,
    relayList: null,
    isLoading: false,
    isSaving: false,
    error: null,
    reload: vi.fn(),
    saveProfile: vi.fn(),
    saveRelays: vi.fn(),
    ...hookState,
  }),
}));

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({ service: null }),
}));

const { ProfileView } = await import('./ProfileView');

const saveButton = () => screen.getByRole('button', { name: 'Save relay list' }) as HTMLButtonElement;

describe('ProfileView relay list', () => {
  it('disables Save and warns when the relay list could not be read', () => {
    hookState = { relayList: { status: 'unreadable' }, existing: { status: 'unreadable' } };
    render(<ProfileView />);
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText(/Could not read your current relay list/)).toBeTruthy();
    expect(screen.queryByText('No relays listed yet.')).toBeNull();
  });

  it('disables Save and Add before any read for this key has finished, without calling it a failure', () => {
    hookState = { relayList: null };
    render(<ProfileView />);
    expect(saveButton().disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Reading your relay list…')).toBeTruthy();
    expect(screen.queryByText('No relays listed yet.')).toBeNull();
    expect(screen.queryByText(/Could not read your current relay list/)).toBeNull();
  });

  it('allows Save and says "none yet" only when a relay answered with no list', () => {
    hookState = { relayList: { status: 'absent' }, existing: { status: 'absent' } };
    render(<ProfileView />);
    expect(saveButton().disabled).toBe(false);
    expect(screen.getByText('No relays listed yet.')).toBeTruthy();
  });

  it('allows Save when the list was found', () => {
    const entries = [{ url: 'wss://existing.example.com', read: true, write: true }];
    hookState = { relayList: { status: 'found', entries }, relays: entries, existing: { status: 'absent' } };
    render(<ProfileView />);
    expect(saveButton().disabled).toBe(false);
    expect(screen.getByText('wss://existing.example.com')).toBeTruthy();
  });
});
