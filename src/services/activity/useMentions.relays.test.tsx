/**
 * Mentions must be asked of the user's read relays, not only ours. A `#p`
 * filter carries no authors, so NDK sends it to our one relay unless told
 * otherwise; the operator's two mentions from the last week were on their
 * read relays and Space showed none (live, 2026-10-16).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const ME = 'ac'.repeat(32);
/** Every subscription opened, so a test can see which are still live. */
const opened: Array<{ urls: string[] | undefined; stop: ReturnType<typeof vi.fn> }> = [];
const subscribe = vi.fn((_filters: unknown, opts: { relaySet?: { urls: string[] } }, _handlers: unknown) => {
  const sub = { urls: opts.relaySet?.urls, stop: vi.fn() };
  opened.push(sub);
  return sub;
});
const live = () => opened.filter((s) => s.stop.mock.calls.length === 0);
let relayList: Array<{ created_at: number; tags: string[][] }> = [];
let relayListHangs = false;
let heldFetch: Promise<Set<unknown>> | null = null;
// Stable across renders, as the real provider's service is.
const stableService = {
  getOwnRelayUrls: () => ['wss://relay.cloistr.xyz'],
  getRelaySetFor: (urls: string[]) => ({ urls }),
};
const fetchEventsMock = vi.fn(() =>
  heldFetch ?? (relayListHangs ? new Promise(() => {}) : Promise.resolve(new Set(relayList)))
);

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({
    subscribe,
    isConnected: true,
    fetchEvents: fetchEventsMock,
    service: stableService,
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
  opened.length = 0;
  fetchEventsMock.mockClear();
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

  // Review of !215 (cloistr-pr, 2026-10-16).
  it('uses the newest relay list when several are returned', async () => {
    relayList = [
      { created_at: 100, tags: [['r', 'wss://old.example']] },
      { created_at: 200, tags: [['r', 'wss://new.example']] },
    ];
    renderHook(() => useMentions());
    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    expect(subscribe.mock.calls[0][1].relaySet?.urls).toEqual(['wss://relay.cloistr.xyz', 'wss://new.example']);
  });

  it('reads the relay list once per key, not on every mark-read', async () => {
    const { result } = renderHook(() => useMentions());
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));

    act(() => result.current.markAsRead('some-id'));
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));

    expect(fetchEventsMock).toHaveBeenCalledTimes(1);
  });

  it('a relay list that arrives after the timeout reopens the read on the inbox relays', async () => {
    vi.useFakeTimers();
    try {
      let release!: (v: Set<unknown>) => void;
      heldFetch = new Promise((r) => { release = r; });
      renderHook(() => useMentions());
      await vi.advanceTimersByTimeAsync(RELAY_LIST_READ_TIMEOUT_MS + 10);
      expect(subscribe.mock.calls.at(-1)![1].relaySet?.urls).toEqual(['wss://relay.cloistr.xyz']);

      await act(async () => {
        release(new Set(relayList));
        await vi.advanceTimersByTimeAsync(10);
      });
      // The reopen runs on the next tick after the re-render.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });

      expect(subscribe.mock.calls.at(-1)![1].relaySet?.urls).toEqual([
        'wss://relay.cloistr.xyz',
        'wss://relay.damus.io',
        'wss://nos.lol',
      ]);

      // Reopened, not doubled: the first read was stopped, and only the
      // inbox-relay read is still open.
      expect(opened[0].stop).toHaveBeenCalled();
      expect(live()).toHaveLength(1);
      expect(live()[0].urls).toContain('wss://relay.damus.io');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a relay-list read that failed is tried again on the next start', async () => {
    fetchEventsMock.mockImplementationOnce(() => Promise.reject(new Error('relay down')));
    const { result } = renderHook(() => useMentions());
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    expect(subscribe.mock.calls[0][1].relaySet?.urls).toEqual(['wss://relay.cloistr.xyz']);
    await new Promise((r) => setTimeout(r, 10));

    act(() => result.current.refresh());
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
    expect(fetchEventsMock).toHaveBeenCalledTimes(2);
    expect(subscribe.mock.calls[1][1].relaySet?.urls).toContain('wss://relay.damus.io');
  });
});
