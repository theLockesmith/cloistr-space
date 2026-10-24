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
vi.mock('@/services/nostr', () => ({
  useNdk: () => ({ subscribe: stableSubscribe, isConnected: true }),
  useHeadlessAdapters: () => ({ signer, relay: null }),
  subscribeStream: (_s: unknown, _f: unknown, handlers: { onEose?: (s: unknown) => void }) => {
    queueMicrotask(() => handlers.onEose?.({ eosesSeen: new Set(['wss://r']) }));
    return { stop: vi.fn() };
  },
}));
const stableSubscribe = vi.fn();
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({ pubkey: ME, isAuthenticated: true }) }));

const { useRecentFiles } = await import('./useRecentFiles');
const { listBlossomFiles, clearBlossomSession, mergeFiles } = await import('./fileSources');

const driveFile = { sha256: 'd1'.repeat(32), name: 'report.pdf', size: 10, mimeType: 'application/pdf', folderId: '', createdAt: 200 };
const blob = { sha256: 'b1'.repeat(32), url: 'https://files.example/' + 'b1'.repeat(32) + '.png', size: 5, type: 'image/png', uploaded: 300 };

beforeEach(() => {
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
