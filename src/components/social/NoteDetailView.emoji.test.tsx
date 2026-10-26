/**
 * @fileoverview The single-post reaction picker shows custom emoji as images.
 *
 * BUG: NoteActions took mirrorMap from useMirrorSign() but never called sign(),
 * so no custom-emoji URL ever got a mirror link. Every custom emoji stayed
 * "pending" and the picker rendered it as :shortcode: text. The feed already
 * called sign(); the single-post view did not.
 *
 * The mirror hook is faked: sign() resolves each URL to a mirror link, and
 * nothing else does. So an image in the picker proves sign() ran with the
 * emoji's URL.
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useCallback, useState } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Note } from '@/types/social';

const NOTE_ID = 'a'.repeat(64);
const CUSTOM = { shortcode: 'blobcat', url: 'https://emoji.example/blobcat.png' };
// One array for the whole run: the real hook memoises its list, and the
// pre-sign effect is keyed on it.
const EMOJI = [{ shortcode: 'heart', native: '❤️' }, CUSTOM];

const note: Note = {
  id: NOTE_ID,
  pubkey: 'b'.repeat(64),
  content: 'hello',
  createdAt: 1_790_000_000,
  mentions: [],
  hashtags: [],
  media: [],
  engagement: { replies: 0, reactions: 0, reposts: 0, zaps: 0 },
  userReacted: false,
  userReposted: false,
} as unknown as Note;

vi.mock('@/services/nostr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/nostr')>()),
  useNdk: () => ({ subscribe: undefined, isConnected: false, relayStatuses: [] }),
  subscribeStream: () => ({ stop: () => {} }),
}));

vi.mock('@/services/social/useNoteThread', () => ({
  useNoteThread: () => ({ root: note, replies: [], replyCount: 0, isLoading: false, notFound: false }),
}));

vi.mock('@/services/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/social')>()),
  useNoteActions: () => ({
    react: vi.fn(),
    repost: vi.fn(),
    undo: vi.fn(),
    reply: vi.fn(),
    canAct: true,
    blockedReason: null,
  }),
}));

vi.mock('@/services/profile/useAuthorProfiles', () => ({
  useAuthorProfiles: () => new Map(),
}));

vi.mock('@/services/social/useEmojiSets', () => ({
  useEmojiSets: () => ({ emoji: EMOJI, isLoading: false }),
}));

vi.mock('@/services/cloistr/useMirrorSign', () => ({
  useMirrorSign: () => {
    const [mirrorMap, setMirrorMap] = useState(new Map());
    const sign = useCallback((urls: string[]) => {
      setMirrorMap((prev) => {
        // Like the real hook, a URL that already has a result is not re-sent.
        if (urls.every((u) => prev.has(u))) return prev;
        const next = new Map(prev);
        for (const u of urls) {
          next.set(u, { state: 'ok', url: `https://mirror.example/${encodeURIComponent(u)}`, expiresAt: 0 });
        }
        return next;
      });
    }, []);
    return { sign, mirrorMap, isSigning: false };
  },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ pubkey: 'c'.repeat(64) }),
}));

const { NoteDetailView } = await import('./NoteDetailView');

afterEach(cleanup);

describe('NoteDetailView reaction picker', () => {
  it('shows a custom emoji as its mirrored image, not as :shortcode: text', async () => {
    render(
      <MemoryRouter initialEntries={[`/e/${NOTE_ID}`]}>
        <Routes>
          <Route path="/e/:id" element={<NoteDetailView />} />
        </Routes>
      </MemoryRouter>
    );

    const trigger = await screen.findByTitle(/Click to react/);
    fireEvent.contextMenu(trigger);

    const picker = await screen.findByRole('menu', { name: 'Pick a reaction' });
    const img = await screen.findByAltText(':blobcat:');
    expect(picker.contains(img)).toBe(true);
    expect(img.getAttribute('src')).toBe(
      `https://mirror.example/${encodeURIComponent(CUSTOM.url)}`
    );
    expect(picker.textContent).not.toContain(':blobcat:');
  });
});
