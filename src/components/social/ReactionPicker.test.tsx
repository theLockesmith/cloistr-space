/**
 * @fileoverview ReactionPicker outside-click / outside-pointer close behaviour.
 *
 * Two failure modes addressed here, both found in the wild:
 *
 * (a) MOBILE — long-press opens the picker, then the browser immediately fires
 *     a compatibility mousedown at the original touch location. Because the
 *     reaction button is outside the picker, the old mousedown listener called
 *     onClose() before the user could see the picker.
 *
 *     After the fix the listener is on pointerdown, not mousedown.  On mobile
 *     the pointerdown fired at t=0 (before the picker mounted); the picker mounts
 *     at t=500 ms; no further pointerdown fires until the user touches again.
 *     A subsequent mousedown at the button does nothing.
 *
 * (b) Complementary: a pointerdown outside DOES close the picker (replaces the
 *     old mousedown close behaviour on desktop too, where both events fire in
 *     lockstep and the behaviour is identical from the user's point of view).
 */

import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ReactionPicker } from './ReactionPicker';
import type { MirrorMap } from '@/services/cloistr/useMirrorSign';
import { FALLBACK_EMOJI } from '@/services/social/emojiSets';

const emptyMirrorMap: MirrorMap = new Map();

function renderPicker(onClose = vi.fn(), onPick = vi.fn()) {
  return render(
    <ReactionPicker
      emoji={FALLBACK_EMOJI}
      isLoading={false}
      mirrorMap={emptyMirrorMap}
      isMirroring={false}
      onPick={onPick}
      onClose={onClose}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe('ReactionPicker outside-click close', () => {
  it('closes when a pointerdown fires outside the picker', () => {
    const onClose = vi.fn();
    renderPicker(onClose);

    // Simulate a pointer press on some element that is outside the picker
    // (plain document.body is always outside).
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does NOT close when a mousedown fires outside (mobile compatibility event)', () => {
    // On mobile a long-press fires pointer events, not mouse events.  After the
    // picker opens the browser synthesises a mousedown at the original touch
    // location as a "compatibility event".  That location is the reaction button,
    // which is outside the picker.  The picker must survive this event or it
    // opens and immediately disappears.
    const onClose = vi.fn();
    renderPicker(onClose);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does NOT close when a pointerdown fires inside the picker', () => {
    const onClose = vi.fn();
    renderPicker(onClose);

    // Pick the first emoji button — it is inside the picker.
    const [firstBtn] = screen.getAllByRole('menuitem');
    firstBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
  });
});
