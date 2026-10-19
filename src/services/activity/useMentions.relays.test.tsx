/**
 * Mentions must be asked of the user's read relays, not only ours. A `#p`
 * filter carries no authors, so NDK sends it to our one relay unless told
 * otherwise; the operator's two mentions from the last week were on their
 * read relays and Space showed none (live, 2026-10-16).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const ME = 'ac'.repeat(32);
const subscribe = vi.fn((_filters: unknown, _opts: { relaySet?: { urls: string[] } }, _handlers: unknown) => ({ stop: vi.fn() }));
let relayList: Array<{ created_at: number; tags: string[][] }> = [];
let relayListHangs = false;
let heldFetch: Promise<Set<unknown>> | null = null;

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({
    subscribe,
    isConnected: true,
    fetchEvents: vi.fn(() =>
      heldFetch ?? (relayListHangs ? new Promise(() => {}) : Promise.resolve(new Set(relayList)))
    ),
    service: {
      getOwnRelayUrls: () => ['wss://relay.cloistr.xyz'],
      getRelaySetFor: (urls: string[]) => ({ urls }),
    },
  }),
  subscribeStream: (sub: typeof subscribe, filters: unknown, handlers: unknown, opts: { relaySet?: { urls: string[] } }) =>
    sub(filters, opts, handlers),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ pubkey: ME, isAuthenticated: true }),
}));

const { useMentions, RELAY_LIST_READ_TIMEOUT_MS } = await import('./useMentions');

beforeEach(() => {
  subscribe.mockClear();
  relayListHangs = false;
  heldFetch = null;
  relayList = [{ created_at: 100, tags: [['r', 'wss://relay.damus.io'], ['r', 'wss://nos.lol', 'read'], ['r', 'wss://out.example', 'write']] }];
});

describe('useMentions relay routing', () => {
  it("asks our relay and the user's read relays", async () => {
    renderHook(() => useMentions());
    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    const { relaySet } = subscribe.mock.calls[0][1];
    expect(relaySet?.urls).toEqual(['wss://relay.cloistr.xyz', 'wss://relay.damus.io', 'wss://nos.lol']);
  });

  it('still asks our relay when the relay list never arrives', async () => {
    vi.useFakeTimers();
    try {
      relayListHangs = true;
      renderHook(() => useMentions());
      await vi.advanceTimersByTimeAsync(RELAY_LIST_READ_TIMEOUT_MS + 10);
      expect(subscribe).toHaveBeenCalled();
      expect(subscribe.mock.calls[0][1].relaySet?.urls).toEqual(['wss://relay.cloistr.xyz']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens no subscription after unmount while the relay list is still loading', async () => {
    let release!: (v: Set<unknown>) => void;
    heldFetch = new Promise((r) => { release = r; });
    const { unmount } = renderHook(() => useMentions());
    await waitFor(() => expect(heldFetch).not.toBeNull());
    await new Promise((r) => setTimeout(r, 10));
    unmount();

    release(new Set(relayList));
    await new Promise((r) => setTimeout(r, 20));
    expect(subscribe).not.toHaveBeenCalled();
  });
});
