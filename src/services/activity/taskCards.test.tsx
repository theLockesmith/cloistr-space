/**
 * #325 (d): the Tasks widget read kind:31990 events, which is not where
 * tasks live, so it could never show a card. It now reads the Tasks API
 * (GET /api/cards?assignee=me, NIP-98). A refused signature or a refused
 * request is an error with a retry, never "No open tasks".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const ME = 'ab'.repeat(32);
const signEvent = vi.fn(async (e: object) => ({ ...e, id: 'id', sig: 'sig' }));
const signer = { getPublicKey: async () => ME, signEvent };
const fetchMock = vi.fn();

vi.mock('@/config/environment', () => ({ config: { tasksUrl: 'https://tasks.cloistr.xyz' } }));
vi.mock('@/services/nostr', () => ({ useHeadlessAdapters: () => ({ signer, relay: null }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({ pubkey: ME }) }));

const { fetchAssignedCards, sortByDue, assignedCardsUrl } = await import('./taskCards');
const { useTaskCards, clearTaskCardsCache } = await import('./useTaskCards');

const card = (id: string, due: string | null, title = `card ${id}`) => ({
  id, title, list_id: 'l1', board_name: 'Space', column_name: 'Doing', due_date: due, url: `/card/${id}`,
});
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  clearTaskCardsCache();
  signEvent.mockReset().mockImplementation(async (e: object) => ({ ...e, id: 'id', sig: 'sig' }));
  fetchMock.mockReset().mockResolvedValue(ok([]));
  vi.stubGlobal('fetch', fetchMock);
});

const authOf = (call: unknown[]) =>
  JSON.parse(atob((call[1] as { headers: { Authorization: string } }).headers.Authorization.slice(6)));

describe('fetchAssignedCards', () => {
  it('signs NIP-98 for the exact URL and method', async () => {
    await fetchAssignedCards(signer as never);
    expect(fetchMock.mock.calls[0][0]).toBe('https://tasks.cloistr.xyz/api/cards?assignee=me');
    const auth = authOf(fetchMock.mock.calls[0]);
    expect(auth.kind).toBe(27235);
    expect(auth.tags).toContainEqual(['u', 'https://tasks.cloistr.xyz/api/cards?assignee=me']);
    expect(auth.tags).toContainEqual(['method', 'GET']);
  });

  it('puts a fresh random nonce on every signing, so two in one second do not collide', async () => {
    await fetchAssignedCards(signer as never);
    await fetchAssignedCards(signer as never);
    const nonces = fetchMock.mock.calls.map((c) => authOf(c).tags.find((t: string[]) => t[0] === 'nonce')?.[1]);
    expect(nonces[0]).toMatch(/^[0-9a-f]{16}$/);
    expect(nonces[1]).not.toBe(nonces[0]);
  });

  it('maps cards to links in the Tasks app', async () => {
    fetchMock.mockResolvedValue(ok([card('7', '2026-10-20')]));
    const [c] = await fetchAssignedCards(signer as never);
    expect(c).toEqual({ id: '7', title: 'card 7', boardName: 'Space', columnName: 'Doing', dueDate: '2026-10-20', href: 'https://tasks.cloistr.xyz/card/7' });
  });

  it('a 401 is an error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await expect(fetchAssignedCards(signer as never)).rejects.toThrow(/did not accept your sign-in/);
  });

  it('URL is the contract one', () => {
    expect(assignedCardsUrl()).toBe('https://tasks.cloistr.xyz/api/cards?assignee=me');
  });
});

describe('sortByDue', () => {
  it('due soonest first, undated last', () => {
    const cards = [card('a', null), card('b', '2026-11-01'), card('c', '2026-10-20')].map((c) => ({
      id: c.id, title: c.title, boardName: '', columnName: '', dueDate: c.due_date, href: '',
    }));
    expect(sortByDue(cards).map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('useTaskCards', () => {
  it('shows the open cards', async () => {
    fetchMock.mockResolvedValue(ok([card('1', null), card('2', '2026-10-18')]));
    const { result } = renderHook(() => useTaskCards());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items.map((c) => c.id)).toEqual(['2', '1']);
    expect(result.current.error).toBeNull();
  });

  it('a refused signature is an error with a retry, never empty', async () => {
    signEvent.mockRejectedValueOnce(new Error('user declined'));
    const { result } = renderHook(() => useTaskCards());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toMatch(/needs your approval to read your tasks/);

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(signEvent).toHaveBeenCalledTimes(2);
  });

  it('a second visit within a few minutes does not ask the signer again', async () => {
    const first = renderHook(() => useTaskCards());
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    first.unmount();
    const second = renderHook(() => useTaskCards());
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(signEvent).toHaveBeenCalledTimes(1);
  });

  it('a refusal is not kept: the next visit asks again instead of showing no tasks', async () => {
    // Only a successful read is reused. Keeping a refusal as an empty list
    // would show "No open tasks" for the whole reuse window.
    signEvent.mockRejectedValueOnce(new Error('user declined'));
    const first = renderHook(() => useTaskCards());
    await waitFor(() => expect(first.result.current.error).not.toBeNull());
    first.unmount();

    fetchMock.mockResolvedValue(ok([card('7', null)]));
    const second = renderHook(() => useTaskCards());
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(signEvent).toHaveBeenCalledTimes(2);
    expect(second.result.current.items.map((c) => c.id)).toEqual(['7']);
    expect(second.result.current.error).toBeNull();
  });

  it('refresh always asks again', async () => {
    const { result } = renderHook(() => useTaskCards());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.refresh());
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(2));
  });
});
