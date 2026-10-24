/**
 * Spec AV3 / RD6: a widget that is empty says why. Before this, every
 * Activity widget showed "No files" / "No mentions" when no relay answered,
 * and a skeleton forever when Space was not connected (the operator's
 * "Activity has been empty since day one").
 *
 * Driven through useRecentFiles; the other relay-backed widget hooks use the same
 * helper, and the per-hook wiring is checked at the end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Handlers = { onEvent?: (e: unknown) => void; onEose?: (sub?: { eosesSeen?: Set<unknown> }) => void };
let lastHandlers: Handlers | null = null;
let connected = true;
// Stable, as the real provider's is: a new function per render would restart
// the read on every state change.
const stableSubscribe = vi.fn();

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({ subscribe: stableSubscribe, isConnected: connected }),
  useHeadlessAdapters: () => ({ signer: null, relay: null }),
  subscribeStream: (_s: unknown, _f: unknown, handlers: Handlers) => {
    lastHandlers = handlers;
    return { stop: vi.fn() };
  },
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ pubkey: 'ab'.repeat(32), isAuthenticated: true }),
}));

const { useRecentFiles } = await import('./useRecentFiles');
const { WIDGET_NO_ANSWER_MS, NO_RELAY_ANSWERED, NOT_CONNECTED } = await import('./widgetReads');

const fileEvent = {
  id: 'f1',
  pubkey: 'ab'.repeat(32),
  kind: 1063,
  created_at: 100,
  content: 'a file',
  tags: [['url', 'https://files.example/x'], ['m', 'text/plain'], ['x', 'aa'], ['name', 'x.txt']],
};

async function mounted() {
  const hook = renderHook(() => useRecentFiles({ includeServices: false }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  lastHandlers = null;
  connected = true;
});
afterEach(() => vi.useRealTimers());

describe('a widget read ends in items, empty, or a named error', () => {
  it('a relay that answered with nothing is empty, not an error', async () => {
    const { result } = await mounted();
    act(() => lastHandlers!.onEose!({ eosesSeen: new Set(['wss://relay']) }));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual([]);
  });

  it('end-of-results with no relay answering is an error, not "nothing here"', async () => {
    const { result } = await mounted();
    act(() => lastHandlers!.onEose!({ eosesSeen: new Set() }));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(NO_RELAY_ANSWERED);
  });

  it('no answer at all within the limit is an error, not an endless skeleton', async () => {
    const { result } = await mounted();
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WIDGET_NO_ANSWER_MS);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(NO_RELAY_ANSWERED);
  });

  it('an event is an answer: no error later', async () => {
    const { result } = await mounted();
    act(() => lastHandlers!.onEvent!(fileEvent));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WIDGET_NO_ANSWER_MS);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(1);
  });

  it('not connected: loading at first, then says it cannot reach a relay', async () => {
    connected = false;
    const { result } = await mounted();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WIDGET_NO_ANSWER_MS);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(NOT_CONNECTED);
  });
});

// Review of !216 (cloistr-pr): guards no test reached. "Try again" on the
// Files and Tasks widgets now calls refresh, so the first one is reachable.
describe('survivors from review', () => {
  it('a refresh while disconnected stays loading, not empty', async () => {
    connected = false;
    const { result } = await mounted();
    act(() => result.current.refresh());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('withReachability keeps a widget\'s items rather than replacing them with the error', async () => {
    // Calendar and Mentions rely on this directly; Files also hides errors itself.
    const { withReachability } = await import('./widgetReads');
    const state = { items: [1], isLoading: false, error: null };
    expect(withReachability(state, true)).toBe(state);
    expect(withReachability({ ...state, items: [] }, true).error).toBe(NOT_CONNECTED);
  });

  it('a widget with files keeps showing them when the connection drops', async () => {
    const hook = await mounted();
    act(() => lastHandlers!.onEvent!(fileEvent));
    connected = false;
    hook.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WIDGET_NO_ANSWER_MS);
    });
    expect(hook.result.current.items).toHaveLength(1);
    expect(hook.result.current.error).toBeNull();
  });

  it('an event the widget filters out still counts as a relay answering', async () => {
    const { result } = await mounted();
    act(() => lastHandlers!.onEvent!({ ...fileEvent, tags: [] }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WIDGET_NO_ANSWER_MS);
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});

describe('every Activity widget hook uses the same rule', () => {
  it.each(['useRecentFiles', 'useCalendar', 'useMentions'])('%s', (name) => {
    const src = readFileSync(join(__dirname, `${name}.ts`), 'utf8');
    expect(src).toContain('trackAnswers(');
    expect(src).toContain('tracked.handlers');
    expect(src).toContain('tracked.cancel()');
    expect(src).toContain('withReachability(state, unreachable)');
  });
});
