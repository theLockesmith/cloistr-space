/**
 * @fileoverview Tests for the note-action precondition gate.
 *
 * This existed as a single boolean, `canAct`, which appeared four times in
 * SocialFeed and never reached a button. So when it was false the controls
 * rendered pixel-identically to working ones and silently did nothing, and the
 * operator reported the heart as "100% unresponsive" -- which is what an
 * unavailable action looks like when nothing says it is unavailable.
 *
 * These tests pin two things: that each precondition is reported distinctly,
 * and the ORDER, which decides what the user is told when more than one is
 * false at once.
 */

import { describe, it, expect } from 'vitest';
import { actionBlockedReason, ACTION_BLOCKED_MESSAGE } from './useNoteActions';

const ready = {
  isAuthenticated: true,
  pubkey: 'abc123',
  publish: () => {},
  isConnected: true,
};

describe('actionBlockedReason', () => {
  it('returns null when every precondition holds', () => {
    expect(actionBlockedReason(ready)).toBeNull();
  });

  it('reports not-signed-in', () => {
    expect(actionBlockedReason({ ...ready, isAuthenticated: false })).toBe('not-signed-in');
  });

  it('reports no-identity when authenticated without a pubkey', () => {
    // Not a contradiction: the SSO bridge sets the flag and the key through
    // separate paths, so one can land without the other. This is exactly the
    // state a single boolean collapsed into "unavailable".
    expect(actionBlockedReason({ ...ready, pubkey: null })).toBe('no-identity');
  });

  it('reports signer-unavailable when publish is not ready', () => {
    // publish comes from a ref-backed context value, so it can legitimately be
    // null on the first renders before the NDK service exists.
    expect(actionBlockedReason({ ...ready, publish: null })).toBe('signer-unavailable');
  });

  it('reports not-connected when no relay is connected', () => {
    expect(actionBlockedReason({ ...ready, isConnected: false })).toBe('not-connected');
  });

  describe('ordering when several fail at once', () => {
    it('prefers not-signed-in over everything else', () => {
      // Most actionable first. Telling a signed-out user "not connected to any
      // relay" is true and useless.
      expect(
        actionBlockedReason({
          isAuthenticated: false,
          pubkey: null,
          publish: null,
          isConnected: false,
        })
      ).toBe('not-signed-in');
    });

    it('prefers no-identity over transport problems', () => {
      expect(
        actionBlockedReason({ ...ready, pubkey: null, publish: null, isConnected: false })
      ).toBe('no-identity');
    });

    it('prefers signer-unavailable over not-connected', () => {
      // A missing publish is a startup state that resolves itself; no relay
      // connection may need user action. Reporting the transient one first
      // avoids sending someone to check their network during a normal boot.
      expect(actionBlockedReason({ ...ready, publish: null, isConnected: false })).toBe(
        'signer-unavailable'
      );
    });
  });

  it('has a message for every reason it can return', () => {
    // A reason with no message would render an empty notice, which is the same
    // silent failure this whole change exists to remove.
    const reasons = [
      actionBlockedReason({ ...ready, isAuthenticated: false }),
      actionBlockedReason({ ...ready, pubkey: null }),
      actionBlockedReason({ ...ready, publish: null }),
      actionBlockedReason({ ...ready, isConnected: false }),
    ];

    for (const reason of reasons) {
      expect(reason).not.toBeNull();
      expect(ACTION_BLOCKED_MESSAGE[reason!], `no message for ${reason}`).toBeTruthy();
    }
  });
});
