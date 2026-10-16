/**
 * #325 (c): Recent Files read only NIP-94 events, which nothing Space or
 * Drive uploads publishes, so a user's Drive files and Blossom blobs never
 * appeared. Now both are listed. Blossom needs a signed list request: made
 * once per session, and a refusal is an error with a retry -- never
 * "No files yet".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const ME = 'ab'.repeat(32);
const driveFiles = vi.fn(async (_pubkey: string) => [] as unknown[]);
const signEvent = vi.fn(async (e: object) => ({ ...e, id: 'id', sig: 'sig' }));
const signer = { getPublicKey: async () => ME, signEvent };
const fetchMock = vi.fn();

vi.mock('@/services/cloistr/drive', () => ({
  getDrive: () => ({
    listFiles: driveFiles,
    getDownloadUrl: (sha: string) => `https://stash.example/api/files/${sha}/download`,
  }),
}));
vi.mock('@/config/environment', () => ({ config: { blossomApiUrl: 'https://files.example' } }));
// Mutable per test: the signed-in key, the signer, and what relays answer.
const env = vi.hoisted(() => ({
  pubkey: 'ab'.repeat(32),
  signerOn: true,
  // Relay events per author; an author missing here gets no answer at all.
  relayEvents: { ['ab'.repeat(32)]: [] } as Record<string, unknown[]>,
  // Every subscription's handlers, in order, so a test can fire a late event
  // on one that was already stopped (NDK 2.18.1 stop() keeps its listeners).
  subs: [] as { author: string; onEvent?: (e: unknown, r: unknown) => void; onEose?: (s: unknown) => void }[],
}));
vi.mock('@/services/nostr', () => ({
  useNdk: () => ({ subscribe: stableSubscribe, isConnected: true }),
  useHeadlessAdapters: () => ({ signer: env.signerOn ? signer : null, relay: null }),
  subscribeStream: (
    _s: unknown,
    filters: { authors: string[] }[],
    handlers: { onEvent?: (e: unknown, r: unknown) => void; onEose?: (s: unknown) => void }
  ) => {
    env.subs.push({ author: filters[0].authors[0], onEvent: handlers.onEvent, onEose: handlers.onEose });
    const events = env.relayEvents[filters[0].authors[0]];
    if (events) {
      queueMicrotask(() => {
        for (const e of events) handlers.onEvent?.(e, { url: 'wss://r' });
        handlers.onEose?.({ eosesSeen: new Set(['wss://r']) });
      });
    }
    return { stop: vi.fn() };
  },
}));
const stableSubscribe = vi.fn();
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({ pubkey: env.pubkey, isAuthenticated: true }) }));

const { useRecentFiles } = await import('./useRecentFiles');
const { listBlossomFiles, clearBlossomSession, mergeFiles } = await import('./fileSources');
const { SIGNER_NOT_READY } = await import('./useRecentFiles');
const { WIDGET_NO_ANSWER_MS } = await import('./widgetReads');
const OTHER = 'cd'.repeat(32);

const driveFile = { sha256: 'd1'.repeat(32), name: 'report.pdf', size: 10, mimeType: 'application/pdf', folderId: '', createdAt: 200 };
const blob = { sha256: 'b1'.repeat(32), url: 'https://files.example/' + 'b1'.repeat(32) + '.png', size: 5, type: 'image/png', uploaded: 300 };

beforeEach(() => {
  env.pubkey = ME;
  env.signerOn = true;
  env.relayEvents = { [ME]: [] };
  env.subs = [];
  clearBlossomSession();
  driveFiles.mockReset().mockResolvedValue([]);
  signEvent.mockReset().mockImplementation(async (e: object) => ({ ...e, id: 'id', sig: 'sig' }));
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
  vi.stubGlobal('fetch', fetchMock);
});

describe('listBlossomFiles', () => {
  it('signs a list request and reads the blobs', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [blob] });
    const files = await listBlossomFiles(signer as never, ME);
    expect(fetchMock).toHaveBeenCalledWith(`https://files.example/list/${ME}`, expect.objectContaining({
      headers: { Authorization: expect.stringMatching(/^Nostr /) },
    }));
    const auth = JSON.parse(atob(fetchMock.mock.calls[0][1].headers.Authorization.slice(6)));
    expect(auth.kind).toBe(24242);
    expect(auth.tags).toContainEqual(['t', 'list']);
    expect(files[0]).toMatchObject({ hash: blob.sha256, mimeType: 'image/png', createdAt: 300 });
  });

  it('signs once per session', async () => {
    await listBlossomFiles(signer as never, ME);
    await listBlossomFiles(signer as never, ME);
    expect(signEvent).toHaveBeenCalledTimes(1);
  });

  it('a refusal is not kept: the next call asks again', async () => {
    signEvent.mockRejectedValueOnce(new Error('user declined'));
    await expect(listBlossomFiles(signer as never, ME)).rejects.toThrow(/approval/);
    await listBlossomFiles(signer as never, ME);
    expect(signEvent).toHaveBeenCalledTimes(2);
  });
});

describe('mergeFiles', () => {
  it('keeps one entry per blob, newest first, earlier sources winning', () => {
    const a = { id: 'nip94', hash: 'h', createdAt: 1, name: 'named', pubkey: ME, url: 'u', mimeType: 'm' };
    const b = { id: 'blossom:h', hash: 'h', createdAt: 5, name: 'bare', pubkey: ME, url: 'u', mimeType: 'm' };
    const c = { id: 'drive:x', hash: 'x', createdAt: 9, name: 'x', pubkey: ME, url: 'u', mimeType: 'm' };
    expect(mergeFiles([[a], [b, c]], 5).map((f) => f.id)).toEqual(['drive:x', 'nip94']);
  });
});

describe('useRecentFiles with Drive and Blossom', () => {
  it('shows Drive files and Blossom blobs', async () => {
    driveFiles.mockResolvedValue([driveFile]);
    fetchMock.mockResolvedValue({ ok: true, json: async () => [blob] });
    const { result } = renderHook(() => useRecentFiles());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items.map((f) => f.hash)).toEqual([blob.sha256, driveFile.sha256]);
    expect(result.current.error).toBeNull();
  });

  it('a refused signature is an error with a retry, never "No files yet"', async () => {
    signEvent.mockRejectedValueOnce(new Error('user declined'));
    const { result } = renderHook(() => useRecentFiles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toMatch(/Cloistr Files: Space needs your approval to list your files there/);

    await act(async () => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(signEvent).toHaveBeenCalledTimes(2);
  });

  it('a Drive that cannot be reached is an error, not empty', async () => {
    driveFiles.mockRejectedValue(new Error('Failed to list files: Bad Gateway'));
    const { result } = renderHook(() => useRecentFiles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toMatch(/Drive: Failed to list files/);
  });

  it('both answering with nothing is the honest empty', async () => {
    const { result } = renderHook(() => useRecentFiles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});

describe('useRecentFiles never shows one key\'s files to another', () => {
  it('a key switch drops the previous key\'s Drive and Blossom files at once', async () => {
    driveFiles.mockResolvedValue([driveFile]);
    fetchMock.mockResolvedValue({ ok: true, json: async () => [blob] });
    const { result, rerender } = renderHook(() => useRecentFiles());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    // The new key's reads never answer, so anything shown now is the old key's.
    driveFiles.mockReturnValue(new Promise(() => {}));
    fetchMock.mockReturnValue(new Promise(() => {}));
    env.pubkey = OTHER;
    rerender();
    expect(result.current.items).toEqual([]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it('a key switch drops the previous key\'s relay files at once', async () => {
    env.relayEvents = {
      [ME]: [{ id: 'e1', pubkey: ME, created_at: 100, tags: [['url', 'https://x/a.pdf'], ['x', 'h1']] }],
    };
    const { result, rerender } = renderHook(() => useRecentFiles({ includeServices: false }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    env.pubkey = OTHER; // no relay answers for OTHER
    rerender();
    // Not "No files yet" either: OTHER's read has not answered.
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it('a late event on the old key\'s stopped subscription changes nothing', async () => {
    const fileOf = (id: string, author: string, hash: string) => ({
      id, pubkey: author, created_at: 100, tags: [['url', `https://x/${hash}`], ['x', hash]],
    });
    env.relayEvents = { [ME]: [fileOf('a1', ME, 'ha1')], [OTHER]: [] };
    const { result, rerender } = renderHook(() => useRecentFiles({ includeServices: false }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    env.pubkey = OTHER;
    rerender();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const stale = env.subs.find((s) => s.author === ME)!;
    const fresh = env.subs.filter((s) => s.author === OTHER).at(-1)!;

    // ME's subscription was stopped, but its listener still fires.
    await act(async () => {
      stale.onEvent?.(fileOf('a2', ME, 'ha2'), { url: 'wss://r' });
      // And its end-of-stored-events: it must not claim the widget back for ME.
      stale.onEose?.({ eosesSeen: new Set(['wss://r']) });
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(false);

    // OTHER's own next file must arrive alone, not carrying ME's.
    await act(async () => {
      fresh.onEvent?.(fileOf('b1', OTHER, 'hb1'), { url: 'wss://r' });
    });
    expect(result.current.items.map((f) => f.id)).toEqual(['b1']);
  });

  it('an event not authored by the signed-in key is never listed', async () => {
    env.relayEvents = {
      [ME]: [{ id: 'x1', pubkey: OTHER, created_at: 100, tags: [['url', 'https://x/z'], ['x', 'hz']] }],
    };
    const { result } = renderHook(() => useRecentFiles({ includeServices: false }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([]);
  });

  it('a key switch then settles on the new key\'s own answer', async () => {
    env.relayEvents = {
      [ME]: [{ id: 'e1', pubkey: ME, created_at: 100, tags: [['url', 'https://x/a.pdf'], ['x', 'h1']] }],
      [OTHER]: [],
    };
    const { result, rerender } = renderHook(() => useRecentFiles({ includeServices: false }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    env.pubkey = OTHER;
    rerender();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});

describe('useRecentFiles with no signer', () => {
  it('is loading at first, then an error, never an endless skeleton', async () => {
    vi.useFakeTimers();
    try {
      env.signerOn = false;
      const { result } = renderHook(() => useRecentFiles());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.isLoading).toBe(true);
      expect(result.current.error).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(WIDGET_NO_ANSWER_MS);
      });
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe(SIGNER_NOT_READY);
    } finally {
      vi.useRealTimers();
    }
  });
});
