/**
 * @fileoverview Tests for notification classification.
 *
 * The mentions widget subscribed to kind:1 ONLY, so "someone replied to you"
 * worked and "someone liked your post" appeared nowhere -- which is most of the
 * interaction people actually receive, and probably why the feature read as
 * absent rather than partial.
 */

import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_VERB,
  classifyNotification,
  showsContent,
} from './notificationKinds';
import { NOTE_KIND, REACTION_KIND, REPOST_KIND, ZAP_RECEIPT_KIND } from '@/types/social';

describe('NOTIFICATION_KINDS', () => {
  it('covers reactions, reposts and zaps beside notes', () => {
    for (const k of [NOTE_KIND, REACTION_KIND, REPOST_KIND, ZAP_RECEIPT_KIND]) {
      expect(NOTIFICATION_KINDS).toContain(k);
    }
  });
});

describe('classifyNotification', () => {
  it('separates a reply from a mention', () => {
    // Both are kind:1 p-tagging you. The difference decides the wording and
    // whether "View post" has anywhere to go.
    expect(classifyNotification(NOTE_KIND, true)).toBe('reply');
    expect(classifyNotification(NOTE_KIND, false)).toBe('mention');
  });

  it('classifies the other kinds', () => {
    expect(classifyNotification(REACTION_KIND, true)).toBe('reaction');
    expect(classifyNotification(REPOST_KIND, true)).toBe('repost');
    expect(classifyNotification(ZAP_RECEIPT_KIND, true)).toBe('zap');
  });

  it('falls back rather than throwing on an unexpected kind', () => {
    // Unreachable given the filter, but a relay can send anything and a crash
    // in a notification list is worse than a slightly wrong label.
    expect(classifyNotification(30023, false)).toBe('mention');
  });
});

describe('showsContent', () => {
  it('shows the body of a reply, mention or reaction', () => {
    // A kind:7's content IS the reaction -- "+" or an emoji -- which is
    // information worth rendering.
    expect(showsContent('reply')).toBe(true);
    expect(showsContent('mention')).toBe(true);
    expect(showsContent('reaction')).toBe(true);
  });

  it('HIDES the body of a repost or zap', () => {
    // A kind:6's content is a JSON dump of the reposted event and a kind:9735's
    // is a receipt. Rendering either as a message body shows a wall of JSON
    // where the reader expected a sentence.
    expect(showsContent('repost')).toBe(false);
    expect(showsContent('zap')).toBe(false);
  });
});

describe('wording', () => {
  it('every type has a verb', () => {
    // A type with no wording renders "<name> " and nothing else.
    for (const t of ['reply', 'mention', 'reaction', 'repost', 'zap'] as const) {
      expect(NOTIFICATION_VERB[t]).toBeTruthy();
    }
  });

  it('the verbs are distinguishable', () => {
    // A list that calls a heart "mentioned you" is worse than one that omits it.
    const verbs = Object.values(NOTIFICATION_VERB);
    expect(new Set(verbs).size).toBe(verbs.length);
  });
});
