/**
 * Pure public-thread operations, callable without React (threads.md 3.1, 3.3).
 *
 * A new thread is a NIP-7D kind 11 root; replies are NIP-22 kind 1111; the
 * owner's archive is a NIP-32 kind 1985 label. Tags come from @cloistr/threads
 * so Space and any headless caller write the same events. Every publish throws
 * when no relay accepts it (see headless.ts).
 *
 * There is no delete here, on purpose: archive is the only end state.
 */

import {
  THREAD_ROOT_KIND,
  STATUS_LABEL_KIND,
  buildPublicRootTags,
  buildPublicReplyTags,
  buildStatusLabelTags,
  type PublicReplyTarget,
} from '@cloistr/threads';
import { signAndPublish, type SignerInterface, type RelayClient, type PublishOutcome } from '../headless';
import { THREAD_KIND } from './threadEvents';

export interface NewPublicThread {
  title: string;
  body: string;
  /** NIP-29 group. Omit for a thread outside any project. */
  groupId?: string;
}

/** Start a public thread. The title is required; the body may be empty. */
export async function createPublicThread(
  signer: SignerInterface,
  relay: RelayClient,
  input: NewPublicThread,
): Promise<PublishOutcome> {
  return signAndPublish(signer, relay, {
    kind: THREAD_ROOT_KIND,
    content: input.body.trim(),
    tags: buildPublicRootTags({ title: input.title, groupId: input.groupId }),
  });
}

/** Reply anywhere in a public thread: the root itself or any reply under it. */
export async function replyToPublicThread(
  signer: SignerInterface,
  relay: RelayClient,
  target: PublicReplyTarget,
  content: string,
): Promise<PublishOutcome> {
  if (!content.trim()) throw new Error('A reply needs some text');
  return signAndPublish(signer, relay, {
    kind: THREAD_KIND,
    content: content.trim(),
    tags: buildPublicReplyTags(target),
  });
}

/**
 * Archive a thread. Readers honour only the root author's label, so this is
 * refused up front for anyone else rather than published and ignored.
 */
export async function archivePublicThread(
  signer: SignerInterface,
  relay: RelayClient,
  root: { id: string; pubkey: string },
): Promise<PublishOutcome> {
  const me = await signer.getPublicKey();
  if (me !== root.pubkey) throw new Error('Only the person who started a thread can archive it');
  return signAndPublish(signer, relay, {
    kind: STATUS_LABEL_KIND,
    content: '',
    tags: buildStatusLabelTags(root.id, 'archived'),
  });
}
