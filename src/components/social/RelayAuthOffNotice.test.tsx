/**
 * @fileoverview The feed says posts may be missing exactly while relay auth is off.
 */

import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NdkService } from '@/services/nostr/ndk';
import { saveRelayAuthEnabled } from '@/services/nostr/authSetting';

let currentService: NdkService | null = null;

vi.mock('@/services/nostr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/nostr')>()),
  useNdk: () => ({ service: currentService }),
}));

const { RelayAuthOffNotice } = await import('./RelayAuthOffNotice');

const renderNotice = () =>
  render(
    <MemoryRouter>
      <RelayAuthOffNotice />
    </MemoryRouter>
  );

describe('RelayAuthOffNotice', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    currentService = null;
  });

  it('says nothing while relay auth is on', () => {
    currentService = new NdkService({ autoConnect: false });
    renderNotice();
    expect(screen.queryByText(/some posts may be missing/i)).toBeNull();
  });

  it('warns, and links to the setting, while relay auth is off', () => {
    currentService = new NdkService({ autoConnect: false });
    currentService.getAuthPolicy().setEnabled(false);
    renderNotice();
    expect(screen.getByRole('status')).toHaveTextContent(/some posts may be missing/i);
    expect(screen.getByRole('link', { name: /change this in profile/i })).toHaveAttribute(
      'href',
      '/profile'
    );
  });

  it('warns from the saved setting before the service exists', () => {
    saveRelayAuthEnabled(false);
    renderNotice();
    expect(screen.getByRole('status')).toHaveTextContent(/some posts may be missing/i);
  });
});
