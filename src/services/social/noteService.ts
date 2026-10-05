/**
 * Pure note operations, callable without React.
 *
 * Each function takes a SignerInterface and a RelayClient. useNoteActions and
 * useCompose supply NDK-backed ones; a headless caller supplies its own. Every
 * publish throws when no relay accepts it (see headless.ts).
 */

import {
  signAndPublish,
  type SignerInterface,
  type RelayClient,
  type PublishOutcome,
} from '../headless';
import { DELETE_KIND, NOTE_KIND, REACTION_KIND, REPOST_KIND } from '@/types/social';

/** Media already uploaded somewhere, ready to reference from a note. */
export interface UploadedMedia {
  url: string;
  mimeType?: string;
}

export interface PostOptions {
  replyTo?: string;
  quote?: string;
  mentions?: string[];
  media?: UploadedMedia[];
}

/**
 * React to a note (kind:7).
 *
 * extraTags carries the NIP-25 `["emoji", shortcode, url]` for a custom
 * reaction. The receiving client needs it to render what the user picked.
 */
export function reactToNote(
  signer: SignerInterface,
  relay: RelayClient,
  eventId: string,
  eventPubkey: string,
  content = '+',
  extraTags: string[][] = [],
): Promise<PublishOutcome> {
  return signAndPublish(signer, relay, {
    kind: REACTION_KIND,
    content,
    tags: [['e', eventId], ['p', eventPubkey], ...extraTags],
  });
}

/**
 * Publish a kind:1 reply.
 *
 * Tags come from the caller (replyEvents.buildReplyTags): placing a reply in a
 * thread needs the root as well as the parent, and only the thread view knows
 * both.
 */
export async function replyToNote(
  signer: SignerInterface,
  relay: RelayClient,
  content: string,
  tags: string[][],
): Promise<PublishOutcome> {
  if (!content.trim()) throw new Error('A reply needs some text');
  return signAndPublish(signer, relay, { kind: NOTE_KIND, content: content.trim(), tags });
}

/**
 * Retract one of your own events via NIP-09 kind:5.
 *
 * A deletion is a REQUEST: relays need not honour it and other clients may
 * keep showing the event.
 */
export function retractEvent(
  signer: SignerInterface,
  relay: RelayClient,
  eventId: string,
): Promise<PublishOutcome> {
  return signAndPublish(signer, relay, { kind: DELETE_KIND, content: '', tags: [['e', eventId]] });
}

/** Repost a note (kind:6). */
export function repostNote(
  signer: SignerInterface,
  relay: RelayClient,
  eventId: string,
  eventPubkey: string,
  relayHint?: string,
): Promise<PublishOutcome> {
  return signAndPublish(signer, relay, {
    kind: REPOST_KIND,
    content: '',
    tags: [['e', eventId, relayHint ?? '', 'mention'], ['p', eventPubkey]],
  });
}

/** Build the content and tags for a new note. Pure; exported for testing. */
export function buildNote(
  content: string,
  options: PostOptions = {},
): { content: string; tags: string[][] } {
  const tags: string[][] = [];
  let finalContent = content;

  for (const media of options.media ?? []) {
    finalContent += `\n${media.url}`;
    const imeta = ['imeta', `url ${media.url}`];
    if (media.mimeType) imeta.push(`m ${media.mimeType}`);
    tags.push(imeta);
  }

  // Simple threads only: replyTo stands in as both root and parent.
  if (options.replyTo) {
    tags.push(['e', options.replyTo, '', 'reply']);
    tags.push(['e', options.replyTo, '', 'root']);
  }

  if (options.quote) tags.push(['q', options.quote]);

  for (const mention of options.mentions ?? []) tags.push(['p', mention]);

  for (const match of finalContent.match(/#(\w+)/g) ?? []) {
    const hashtag = match.slice(1).toLowerCase();
    if (!tags.some((t) => t[0] === 't' && t[1] === hashtag)) tags.push(['t', hashtag]);
  }

  return { content: finalContent.trim(), tags };
}

/**
 * Post a note (kind:1). Media must already be uploaded; pass its URLs.
 */
export async function postNote(
  signer: SignerInterface,
  relay: RelayClient,
  content: string,
  options: PostOptions = {},
): Promise<PublishOutcome> {
  if (!content.trim() && !options.media?.length) throw new Error('Cannot post empty note');
  const note = buildNote(content, options);
  return signAndPublish(signer, relay, { kind: NOTE_KIND, ...note });
}
