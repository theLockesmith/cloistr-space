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

// ---------------------------------------------------------------------------
// Author filter
// ---------------------------------------------------------------------------

/**
 * A pubkey-aware group identifier: slug, then a 16-hex creator prefix, then an
 * 8-hex random suffix. See services/groups/ownership.ts OWNER_PATTERN.
 */
const OWNED_ID = `design-team-${'a'.repeat(16)}-deadbeef`;

function metadataEvent(pubkey: string, identifier: string, name: string) {
  return {
    id: `evt-${pubkey.slice(0, 4)}`,
    pubkey,
    content: '',
    tags: [['d', identifier], ['name', name], ['public']],
    created_at: 1000,
    relay: { url: 'wss://relay.cloistr.xyz' },
  };
}

describe('GroupBrowser author filter', () => {
  it('hides a public group whose author does not match the identifier owner', async () => {
    // The attack: publish a kind:39000 carrying someone else's `d` identifier
    // plus a `public` tag, and a private group appears in the public directory
    // under a name the attacker chose.
    fetchFromOwnRelays.mockResolvedValue(
      new Set([
        metadataEvent('b'.repeat(64), OWNED_ID, 'Impersonated Group'),
        metadataEvent('c'.repeat(64), 'legacy-group-id', 'Legacy Group'),
      ])
    );

    render(<GroupBrowser />);

    // Positive control in the same render: the legacy identifier has no owner
    // prefix to verify against and must still be listed, so a green here
    // cannot come from the component rendering nothing at all.
    expect(await screen.findByText('Legacy Group')).toBeDefined();
    expect(screen.queryByText('Impersonated Group')).toBeNull();
  });

  it('shows a public group whose author matches the identifier owner', async () => {
    fetchFromOwnRelays.mockResolvedValue(
      new Set([metadataEvent('a'.repeat(64), OWNED_ID, 'Real Group')])
    );

    render(<GroupBrowser />);

    expect(await screen.findByText('Real Group')).toBeDefined();
  });
});
