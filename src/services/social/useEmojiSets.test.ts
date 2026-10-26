/**
 * @fileoverview useEmojiSets returns the same emoji array across re-renders.
 *
 * Callers key effects on it (SocialFeed and NoteDetailView pre-sign custom
 * emoji URLs for the mirror). A fresh array each render re-ran those effects
 * on every render, and each run could start another signer round trip.
 */

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/services/nostr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/nostr')>()),
  useNdk: () => ({ subscribe: undefined, isConnected: false }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: (s: { pubkey: string }) => unknown) => {
    const state = { pubkey: 'c'.repeat(64) };
    return selector ? selector(state) : state;
  },
}));

const { useEmojiSets } = await import('./useEmojiSets');

describe('useEmojiSets', () => {
  it('returns the same emoji array when nothing changed', () => {
    const { result, rerender } = renderHook(() => useEmojiSets());
    const first = result.current.emoji;
    rerender();
    rerender();
    expect(result.current.emoji).toBe(first);
  });
});
