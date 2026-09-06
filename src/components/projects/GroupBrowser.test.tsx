/**
 * @fileoverview Tests for GroupBrowser relay routing.
 *
 * GroupBrowser fetches kind:39000 (group metadata), which lives on the group's
 * relay. Without pinning to own relays, NDK routes the query by its default
 * (no authors in filter -> explicitRelayUrls), which happens to include our
 * relay today but is not guaranteed. See relayRouting.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const fetchFromOwnRelays = vi.fn().mockResolvedValue(new Set());
let connected = true;

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({
    fetchFromOwnRelays,
    isConnected: connected,
  }),
}));

vi.mock('@/services/groups/useGroupActions', () => ({
  useGroupActions: () => ({
    joinGroup: vi.fn(),
    canAct: true,
  }),
}));

const { GroupBrowser } = await import('./GroupBrowser');

beforeEach(() => {
  fetchFromOwnRelays.mockClear();
  fetchFromOwnRelays.mockResolvedValue(new Set());
  connected = true;
});

// ---------------------------------------------------------------------------
// Relay routing
// ---------------------------------------------------------------------------

describe('GroupBrowser relay routing', () => {
  it('fetches group metadata via fetchFromOwnRelays, not fetchEvents', () => {
    render(<GroupBrowser />);

    expect(fetchFromOwnRelays).toHaveBeenCalledTimes(1);
    expect(fetchFromOwnRelays).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: [39000] })
    );
  });

  it('does not fetch when disconnected', () => {
    connected = false;
    render(<GroupBrowser />);

    expect(fetchFromOwnRelays).not.toHaveBeenCalled();
  });

  it('renders groups returned from the fetch', async () => {
    const fakeEvent = {
      id: 'evt-1',
      pubkey: 'a'.repeat(64),
      content: '',
      tags: [
        ['d', 'test-group-id'],
        ['name', 'Test Project'],
        ['public'],
        ['about', 'A test group'],
      ],
      created_at: 1000,
      relay: { url: 'wss://relay.cloistr.xyz' },
    };

    fetchFromOwnRelays.mockResolvedValue(new Set([fakeEvent]));

    render(<GroupBrowser />);

    // Wait for the async fetch to resolve and the component to update.
    const groupName = await screen.findByText('Test Project');
    expect(groupName).toBeDefined();
  });
});
