import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const upload = vi.fn();
const relayPublish = vi.fn(async () => 1);

vi.mock('@/services/nostr', () => ({
  useNdk: () => ({ publish: vi.fn(), isConnected: true }),
  useHeadlessAdapters: () => ({
    signer: {
      getPublicKey: async () => 'aa'.repeat(32),
      signEvent: async (u: object) => ({ ...u, id: 'bb'.repeat(32), sig: 'cc'.repeat(64) }),
      encrypt: async () => '',
      decrypt: async () => '',
    },
    relay: { publish: relayPublish, fetch: async () => [] },
  }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ pubkey: 'aa'.repeat(32), isAuthenticated: true }),
}));
vi.mock('@/services/cloistr/useFileUpload', () => ({
  useFileUpload: () => ({ upload, isUploading: false, progress: 0 }),
}));

const { useCompose } = await import('./useCompose');

const file = (name: string) => new File(['x'], name, { type: 'image/png' });

describe('useCompose', () => {
  beforeEach(() => {
    upload.mockReset();
    relayPublish.mockClear();
  });

  it('posts nothing and says which uploads failed, rather than "empty note"', async () => {
    // A media-only post whose uploads all failed used to surface as
    // "Cannot post empty note", which blames the user for writing nothing.
    upload.mockResolvedValue(null);
    const { result } = renderHook(() => useCompose());

    let error: unknown;
    await act(async () => {
      await result.current.post('', { media: [file('a.png'), file('b.png')] }).catch((e) => (error = e));
    });

    expect((error as Error).message).toMatch(/2 of 2 attachments failed to upload/);
    expect(relayPublish).not.toHaveBeenCalled();
  });

  it('does not post a note missing some of the attached media', async () => {
    upload.mockResolvedValueOnce({ url: 'https://files.example/a.png' }).mockResolvedValueOnce(null);
    const { result } = renderHook(() => useCompose());

    let error: unknown;
    await act(async () => {
      await result.current.post('look', { media: [file('a.png'), file('b.png')] }).catch((e) => (error = e));
    });

    expect((error as Error).message).toMatch(/1 of 2 attachments failed to upload/);
    expect(relayPublish).not.toHaveBeenCalled();
  });

  it('posts with every uploaded attachment', async () => {
    upload.mockResolvedValue({ url: 'https://files.example/a.png' });
    const { result } = renderHook(() => useCompose());

    await act(async () => {
      await result.current.post('look', { media: [file('a.png')] });
    });

    expect(relayPublish).toHaveBeenCalledOnce();
  });
});
