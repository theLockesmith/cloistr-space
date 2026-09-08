/**
 * @fileoverview Tests for useProfile.saveRelays pool-before-publish ordering.
 *
 * A new user's NDK pool contains only the default relay. saveRelays must add
 * the declared relays to the pool (via setConfiguredRelays) BEFORE publishing
 * the kind:10002, so the event reaches the relays the user just chose.
 * Without this, the publish goes to the default relay alone, which may refuse
 * a non-whitelisted pubkey, creating a permanent bootstrap deadlock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const callOrder: string[] = [];

const mockAuthPolicy = {
  setTrustedRelays: vi.fn(),
};

const mockService = {
  setConfiguredRelays: vi.fn((..._args: unknown[]) => {
    callOrder.push('setConfiguredRelays');
  }),
  getAuthPolicy: vi.fn(() => mockAuthPolicy),
};

const mockPublish = vi.fn(async () => {
  callOrder.push('publish');
  return new Set();
});

const mockCreateEvent = vi.fn(() => ({
  kind: 0,
  content: '',
  tags: [] as string[][],
  id: 'test-event-id',
}));

let connected = true;

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({
    subscribe: vi.fn(),
    service: mockService,
    publish: mockPublish,
    createEvent: mockCreateEvent,
    isConnected: connected,
    fetchFromOwnRelays: vi.fn().mockResolvedValue(new Set()),
  }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    pubkey: 'a'.repeat(64),
    isAuthenticated: true,
  }),
}));

const { useProfile } = await import('./useProfile');

beforeEach(() => {
  callOrder.length = 0;
  mockPublish.mockClear();
  mockCreateEvent.mockClear();
  mockService.setConfiguredRelays.mockClear();
  mockAuthPolicy.setTrustedRelays.mockClear();
  connected = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pool-before-publish ordering
// ---------------------------------------------------------------------------

describe('useProfile.saveRelays', () => {
  it('calls setConfiguredRelays before publish so declared relays are in the pool', async () => {
    const { result } = renderHook(() => useProfile());

    const entries = [
      { url: 'wss://relay.example.com', read: true, write: true },
      { url: 'wss://backup.example.com', read: true, write: false },
    ];

    await act(async () => {
      await result.current.saveRelays(entries);
    });

    // setConfiguredRelays must have been called with the declared URLs.
    expect(mockService.setConfiguredRelays).toHaveBeenCalledWith([
      'wss://relay.example.com',
      'wss://backup.example.com',
    ]);

    // And it must have been called BEFORE publish.
    expect(callOrder).toEqual(['setConfiguredRelays', 'publish']);
  });

  it('publishes the kind:10002 event to whatever is now in the pool', async () => {
    const { result } = renderHook(() => useProfile());

    const entries = [
      { url: 'wss://relay.example.com', read: true, write: true },
    ];

    await act(async () => {
      await result.current.saveRelays(entries);
    });

    // publish was called (the event reaches the now-expanded pool).
    expect(mockPublish).toHaveBeenCalledTimes(1);

    // The event should be kind:10002.
    const event = mockCreateEvent.mock.results[0]?.value;
    expect(event.kind).toBe(10002);
  });
});
