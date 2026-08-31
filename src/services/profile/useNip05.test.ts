/**
 * @fileoverview Tests for the NIP-05 verification hook.
 *
 * Tests cover all three outcome states (verified/unverified/unknown) and
 * confirm that network failures surface as UNKNOWN, not UNVERIFIED.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useNip05 } from './useNip05';

const PUBKEY = 'ac16282f720514d926a57b5c13f02d1f4e32bd6fe3e00f713f50964571685f62';
const NIP05 = 'lockesmith@coldforge.xyz';

function mockFetch(body: unknown, ok = true, status = 200): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function failFetch(err: unknown = new TypeError('Network error')): void {
  vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(err);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useNip05', () => {
  it('returns null for both undefined inputs', () => {
    const { result } = renderHook(() => useNip05(undefined, undefined));
    expect(result.current).toBe(null);
  });

  it('returns null when nip05 is undefined', () => {
    const { result } = renderHook(() => useNip05(undefined, PUBKEY));
    expect(result.current).toBe(null);
  });

  it('returns verified when pubkeys match', async () => {
    mockFetch({ names: { lockesmith: PUBKEY } });
    const { result } = renderHook(() => useNip05(NIP05, PUBKEY));
    await waitFor(() => expect(result.current).toBe('verified'));
  });

  it('is case-insensitive for the returned pubkey', async () => {
    mockFetch({ names: { lockesmith: PUBKEY.toUpperCase() } });
    const { result } = renderHook(() => useNip05(NIP05, PUBKEY));
    await waitFor(() => expect(result.current).toBe('verified'));
  });

  it('returns unverified when pubkeys do not match', async () => {
    mockFetch({ names: { lockesmith: 'aabb' + PUBKEY.slice(4) } });
    const { result } = renderHook(() => useNip05(NIP05, PUBKEY));
    await waitFor(() => expect(result.current).toBe('unverified'));
  });

  it('returns unverified when the name is not in the response', async () => {
    mockFetch({ names: { someone_else: PUBKEY } });
    const { result } = renderHook(() => useNip05(NIP05, PUBKEY));
    await waitFor(() => expect(result.current).toBe('unverified'));
  });

  it('returns unknown when the fetch fails (network error)', async () => {
    failFetch();
    const { result } = renderHook(() => useNip05(NIP05, PUBKEY));
    await waitFor(() => expect(result.current).toBe('unknown'));
  });

  it('returns unknown when the server responds with a non-2xx status', async () => {
    mockFetch(null, false, 404);
    const { result } = renderHook(() => useNip05(NIP05, PUBKEY));
    await waitFor(() => expect(result.current).toBe('unknown'));
  });

  it('returns unknown when the response json rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    } as Response);
    const { result } = renderHook(() => useNip05(NIP05, PUBKEY));
    await waitFor(() => expect(result.current).toBe('unknown'));
  });

  it('returns unknown when the response has no names field', async () => {
    mockFetch({ relays: {} });
    const { result } = renderHook(() => useNip05(NIP05, PUBKEY));
    await waitFor(() => expect(result.current).toBe('unknown'));
  });

  it('returns unknown synchronously when address has no @ sign', () => {
    const { result } = renderHook(() => useNip05('notanaddress', PUBKEY));
    expect(result.current).toBe('unknown');
  });
});
