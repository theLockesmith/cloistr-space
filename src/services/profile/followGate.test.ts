/**
 * @fileoverview Tests for when following is unavailable, and why.
 *
 * The reason matters as much as the boolean. A disabled Follow button with no
 * explanation is the same failure as the reaction buttons had: the interface
 * knows exactly why it will not act and says nothing, so the user concludes it
 * is broken.
 */

import { describe, it, expect } from 'vitest';
import { followBlockedReason, FOLLOW_BLOCKED_MESSAGE } from './useFollow';

const ME = 'a'.repeat(64);
const THEM = 'b'.repeat(64);

describe('followBlockedReason', () => {
  it('allows following a stranger when signed in and connected', () => {
    expect(followBlockedReason(ME, THEM, true)).toBeNull();
  });

  it('blocks when signed out', () => {
    expect(followBlockedReason(null, THEM, true)).toBe('not-signed-in');
  });

  it('blocks following yourself', () => {
    expect(followBlockedReason(ME, ME, true)).toBe('self');
  });

  it('blocks when the relay connection is not ready', () => {
    // Following publishes a kind:33000. Letting the button work before there is
    // anywhere to publish to would show a follow that never left the browser.
    expect(followBlockedReason(ME, THEM, false)).toBe('not-ready');
  });

  it('reports "self" ahead of "not-ready" when both are true', () => {
    // Ordering is deliberate: one is a permanent fact about the page and the
    // other is transient. Telling someone to wait for a connection so they can
    // follow themselves is worse than useless.
    expect(followBlockedReason(ME, ME, false)).toBe('self');
  });

  it('reports "not-signed-in" ahead of everything', () => {
    expect(followBlockedReason(null, THEM, false)).toBe('not-signed-in');
  });

  it('has a message for every reason it can return', () => {
    // A reason with no message renders an empty explanation, which is the
    // silent-disable failure wearing a different hat.
    for (const reason of ['not-signed-in', 'self', 'not-ready'] as const) {
      expect(FOLLOW_BLOCKED_MESSAGE[reason]).toBeTruthy();
    }
  });
});
