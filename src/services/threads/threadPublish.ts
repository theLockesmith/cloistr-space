/**
 * Pure thread publish operations, callable without React.
 *
 * Wraps giftWrap.ts (which builds and signs events with one-time keys) and
 * publishes each wrap on a connection signed in as its own one-time key; see
 * wrapRelay.ts for why never the caller's connection. A headless caller passes
 * `open` to supply its own connections.
 *
 * Gift wraps are signed with one-time keys inside giftWrap.ts, never the
 * user's signer. The signer is needed only by publishKeyHandoffViaSigner, for
 * the hand-off's mailbox tag.
 */

import type { SignerInterface } from '@cloistr/auth';
import { wrapThreadMessageWithKey, wrapKeyHandoffWithKey, wrapKeyHandoffInBucket } from './giftWrap';
import { publishWrap, type WrapPublishOptions } from './wrapRelay';
import { getWindowId } from './bucketCrypto';
import { signerEcdhTag } from './signerEcdh';

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

/**
 * Hand a thread key to a member when the granter's secret key is in a signer.
 *
 * The mailbox tag is the only part that needs the granter's key, and the
 * signer's `cloistr_ecdh_tag(member, window)` gives the same tag the member's
 * side computes from the granter's pubkey (ECDH is symmetric). The window is
 * picked once, so a grant at midnight cannot ask for one day's tag and stamp
 * the wrap with the next day's expiry.
 *
 * Throws, publishing nothing, when the signer cannot give the tag (browser
 * extensions have no such method) or its pubkey: a hand-off in a guessed
 * mailbox is one nobody reads.
 */
export async function publishKeyHandoffViaSigner(
  threadId: string,
  threadSecretHex: string,
  signer: SignerInterface,
  memberPubkey: string,
  opts: ThreadPublishOptions = {},
): Promise<void> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const windowId = getWindowId(now);

  const granterPubkey = await signer.getPublicKey();
  if (typeof granterPubkey !== 'string' || !/^[0-9a-f]{64}$/.test(granterPubkey)) {
    throw new Error('The signer did not say which key it holds, so the hand-off was not sent.');
  }
  const bucket = await signerEcdhTag(signer, memberPubkey, windowId);
  if (!bucket) {
    throw new Error('The signer could not work out the hand-off mailbox, so the hand-off was not sent.');
  }

  const { event, oneTimeSk } = wrapKeyHandoffInBucket(threadId, threadSecretHex, granterPubkey, memberPubkey, bucket, now);
  await publishWrap(event, oneTimeSk, opts);
}
