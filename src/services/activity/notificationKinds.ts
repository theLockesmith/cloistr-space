/**
 * @fileoverview What kind of thing just happened to you.
 *
 * The mentions widget subscribed to kind:1 only, so "someone replied to you"
 * worked and "someone liked your post" did not appear anywhere. That asymmetry
 * is probably why the feature read as absent: the interactions people get most
 * of were the ones it could not show.
 *
 * Widening the kinds is most of the work. Classifying them is the rest, because
 * a reply and a reaction need different words and a list that calls a heart
 * "mentioned you" is worse than one that omits it.
 */

import { NOTE_KIND, REACTION_KIND, REPOST_KIND, ZAP_RECEIPT_KIND } from '@/types/social';

/** Kinds that can be addressed to you via a `p` tag. */
export const NOTIFICATION_KINDS: number[] = [
  NOTE_KIND,
  REACTION_KIND,
  REPOST_KIND,
  ZAP_RECEIPT_KIND,
];

export type NotificationType = 'reply' | 'mention' | 'reaction' | 'repost' | 'zap';

/**
 * Classify an event addressed to us.
 *
 * A kind:1 is a REPLY when it references an event, and a MENTION when it does
 * not -- the difference matters to a reader deciding whether to open it, and
 * both are kind:1 p-tagging you.
 */
export function classifyNotification(kind: number, hasEventRef: boolean): NotificationType {
  switch (kind) {
    case REACTION_KIND:
      return 'reaction';
    case REPOST_KIND:
      return 'repost';
    case ZAP_RECEIPT_KIND:
      return 'zap';
    case NOTE_KIND:
      return hasEventRef ? 'reply' : 'mention';
    default:
      // Unreachable given the filter, and a mention is the least wrong guess
      // for something p-tagging you that we do not recognise.
      return 'mention';
  }
}

/** Sentence fragment for each type, completing "<name> …". */
export const NOTIFICATION_VERB: Record<NotificationType, string> = {
  reply: 'replied to you',
  mention: 'mentioned you',
  reaction: 'reacted to your post',
  repost: 'reposted you',
  zap: 'zapped you',
};

/**
 * Whether a notification's own content is worth showing.
 *
 * A kind:7's content is the reaction itself -- "+" or an emoji -- which is
 * information. A kind:6's content is a JSON dump of the reposted event, and a
 * kind:9735's is a zap receipt: rendering either as a message body would show
 * the user a wall of JSON where they expected a sentence.
 */
export function showsContent(type: NotificationType): boolean {
  return type === 'reply' || type === 'mention' || type === 'reaction';
}
