/**
 * Pure thread publish operations, callable without React.
 *
 * Wraps giftWrap.ts (which builds and signs events with one-time keys) and
 * publishes each wrap on a connection signed in as its own one-time key; see
 * wrapRelay.ts for why never the caller's connection. A headless caller passes
 * `open` to supply its own connections.
 *
 * No SignerInterface needed: gift wraps are signed with one-time keys
 * inside giftWrap.ts, not the user's signer.
 */

import { wrapThreadMessageWithKey, wrapKeyHandoffWithKey } from './giftWrap';
import { publishWrap, type WrapPublishOptions } from './wrapRelay';

export interface ThreadPublishOptions extends WrapPublishOptions {
  nowSec?: number;
}

export async function publishMessage(
  plaintext: string,
  authorPubkey: string,
  threadSecretHex: string,
  opts: ThreadPublishOptions = {},
): Promise<void> {
  const { event, oneTimeSk } = wrapThreadMessageWithKey(plaintext, authorPubkey, threadSecretHex, opts.nowSec);
  await publishWrap(event, oneTimeSk, opts);
}

export async function publishKeyHandoff(
  threadId: string,
  threadSecretHex: string,
  granterSk: Uint8Array,
  recipientPubkey: string,
  opts: ThreadPublishOptions = {},
): Promise<void> {
  const { event, oneTimeSk } = wrapKeyHandoffWithKey(threadId, threadSecretHex, granterSk, recipientPubkey, opts.nowSec);
  await publishWrap(event, oneTimeSk, opts);
}
