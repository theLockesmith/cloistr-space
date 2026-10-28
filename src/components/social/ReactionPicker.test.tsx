/**
 * @fileoverview Tests for the privacy-critical half of the picker: custom
 * emoji must never cause an <img> to load from a third-party host, and the
 * "Customize" entry point must actually be reachable when offered.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReactionPicker } from './ReactionPicker';
import type { EmojiEntry } from '@/services/social/emojiSets';
import type { MirrorMap } from '@/services/cloistr/useMirrorSign';

const THIRD_PARTY_URL = 'https://evil-stranger.test/x.png';
const OUR_MIRROR_URL = 'https://files.cloistr.xyz/media/mirror?u=abc&s=def';

const customEntry: EmojiEntry = { shortcode: 'party', url: THIRD_PARTY_URL };
const nativeEntry: EmojiEntry = { shortcode: 'fire', native: '🔥' };

function noop() {}

describe('ReactionPicker never fetches a third-party image', () => {
  it('renders no <img> at all when the mirror has not resolved the url', () => {
    const { container } = render(
      <ReactionPicker
        emoji={[customEntry]}
        isLoading={false}
        mirrorMap={new Map()}
        isMirroring={false}
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(container.querySelectorAll('img')).toHaveLength(0);
    // The shortcode still shows as text, so the feature is not silently lost.
    expect(screen.getByText(':party:')).toBeInTheDocument();
  });

  it('renders no <img> for a disabled, refused, or unreachable mirror result', () => {
    for (const state of [
      { state: 'disabled' as const },
      { state: 'refused' as const },
      { state: 'unreachable' as const, retryAfter: 0 },
    ]) {
      const mirrorMap: MirrorMap = new Map([[THIRD_PARTY_URL, state]]);
      const { container, unmount } = render(
        <ReactionPicker
          emoji={[customEntry]}
          isLoading={false}
          mirrorMap={mirrorMap}
          isMirroring={false}
          onPick={noop}
          onClose={noop}
        />,
      );
      const imgs = Array.from(container.querySelectorAll('img'));
      expect(imgs.every((img) => !img.src.includes('evil-stranger.test'))).toBe(true);
      unmount();
    }
  });

  it('even when the mirror resolved "ok", the <img> src is OUR mirror, never the original third-party url', () => {
    const mirrorMap: MirrorMap = new Map([
      [THIRD_PARTY_URL, { state: 'ok', url: OUR_MIRROR_URL, expiresAt: Date.now() / 1000 + 300 }],
    ]);
    const { container } = render(
      <ReactionPicker
        emoji={[customEntry]}
        isLoading={false}
        mirrorMap={mirrorMap}
        isMirroring={false}
        onPick={noop}
        onClose={noop}
      />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.src).toContain('files.cloistr.xyz');
    expect(img?.src).not.toContain('evil-stranger.test');
  });

  it('renders a unicode entry as its glyph, not as an image', () => {
    const { container } = render(
      <ReactionPicker
        emoji={[nativeEntry]}
        isLoading={false}
        mirrorMap={new Map()}
        isMirroring={false}
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getByText('🔥')).toBeInTheDocument();
  });
});

describe('the picker shows the user\'s own list', () => {
  it('renders every entry passed in, unicode and custom alike', () => {
    render(
      <ReactionPicker
        emoji={[nativeEntry, customEntry]}
        isLoading={false}
        mirrorMap={new Map()}
        isMirroring={false}
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByText('🔥')).toBeInTheDocument();
    expect(screen.getByText(':party:')).toBeInTheDocument();
  });
});

describe('the Customize entry point', () => {
  it('is absent when onManage is not provided', () => {
    render(
      <ReactionPicker
        emoji={[nativeEntry]}
        isLoading={false}
        mirrorMap={new Map()}
        isMirroring={false}
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(screen.queryByText(/customize/i)).toBeNull();
  });

  it('calls both onClose and onManage when clicked', () => {
    const onClose = vi.fn();
    const onManage = vi.fn();
    render(
      <ReactionPicker
        emoji={[nativeEntry]}
        isLoading={false}
        mirrorMap={new Map()}
        isMirroring={false}
        onPick={noop}
        onClose={onClose}
        onManage={onManage}
      />,
    );
    fireEvent.click(screen.getByText(/customize/i));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onManage).toHaveBeenCalledTimes(1);
  });
});
