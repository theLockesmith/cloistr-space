/**
 * @fileoverview Can a USER actually do these things?
 *
 * Written because the operator reported un-hearting as broken when it had never
 * worked: the code path existed, the control was rendered, and it returned
 * early on every press. What the code PERMITS and what a user CAN DO diverged,
 * and nobody noticed until they tried it.
 *
 * So these assert the user-facing shape of each action -- that the control is
 * reachable, that it is not inert, and that the thing it claims to do has a
 * caller. They are deliberately about the surface rather than the service
 * layer, which has its own tests.
 *
 * Source-level for the same reason as the other guards here: driving the real
 * thing needs a signer, a relay and a round trip, and what actually broke was
 * structural rather than behavioural.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const feed = readFileSync(join(__dirname, 'SocialFeed.tsx'), 'utf8');
const repostMenu = readFileSync(join(__dirname, 'RepostMenu.tsx'), 'utf8');
const quote = readFileSync(join(__dirname, 'QuoteComposer.tsx'), 'utf8');

describe('every action control is reachable and not inert', () => {
  it('has no permanently disabled action buttons left', () => {
    // Reply, share and zap were each shipped as `disabled` placeholders at some
    // point. A control that renders and cannot ever act is worse than an absent
    // one, because it advertises a capability that does not exist.
    //
    // Zap is still absent -- deliberately, since it is not built -- so this
    // asserts there is no HARD-CODED disabled, not that nothing is ever
    // disabled. canAct-driven disabling is correct and stays.
    const hardDisabled = feed.match(/^\s*disabled\s*$/gm) ?? [];

    expect(
      hardDisabled.length,
      'a hard-coded `disabled` means a control nobody can ever use'
    ).toBe(0);
  });

  it('reacting can be undone from the same control', () => {
    // The exact bug: tapping a filled heart returned early and did nothing.
    expect(feed).toMatch(/getOwnReactionId/);
    expect(feed).not.toMatch(/if \(!canAct \|\| note\.userReacted\) return;/);
  });

  it('reposting offers repost, quote and undo as VISIBLE choices', () => {
    // Not behind a hold. The operator looked for a right-click menu on
    // projects, did not find one, and reported the capability as missing --
    // discoverability is not a nicety here, it is the difference between a
    // feature existing and being reported as absent.
    expect(repostMenu).toMatch(/Quote post/);
    expect(repostMenu).toMatch(/Undo repost/);
    expect(repostMenu).toMatch(/role="menu"/);
  });

  it('a quote carries BOTH the q tag and an inline nevent', () => {
    // The tag is what clients index on; the inline reference is what clients
    // that ignore `q` tags render. Emitting one without the other makes the
    // quote invisible in half the ecosystem.
    expect(quote).toMatch(/quote: note\.id/);
    expect(quote).toMatch(/nostr:\$\{nevent\}/);
  });

  it('a quote p-tags the author being quoted', () => {
    // Otherwise a quote is a conversation about someone that they never hear.
    expect(quote).toMatch(/mentions: \[note\.pubkey\]/);
  });

  it('a quote embeds relay hints', () => {
    // A bare nevent is unresolvable for anyone not already on our relay, which
    // is nearly everyone.
    expect(feed).toMatch(/relays=\{quoteHints\}/);
    expect(feed).toMatch(/ownRelayHints/);
  });

  it('every failure path says something', () => {
    // Silence after an action is the failure this whole surface keeps
    // producing. Each action reports its own refusal.
    for (const phrase of [
      'Reaction not sent',
      'Reaction not removed',
      'Repost not sent',
      'Repost not removed',
    ]) {
      expect(feed, `missing user-facing failure text: ${phrase}`).toContain(phrase);
    }
    expect(quote).toContain('Quote not posted');
  });
});
