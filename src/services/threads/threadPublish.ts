/**
 * Pure thread publish operations, callable without React.
 *
 * Wraps giftWrap.ts (which builds and signs events with one-time keys) and
 * publishes each wrap on a connection signed in as its own one-time key; see
 * wrapRelay.ts for why never the caller's connection. A headless caller passes
 * `open` to supply its own connections.
 *
 * Gift wraps are signed with one-time keys inside giftWrap.ts, not the user's
 * signer. The one exception is the gate yes: the event INSIDE its wrap must be
 * signed by the user's own key, because that signature is the approval.
 */

import { wrapThreadMessageWithKey, wrapKeyHandoffWithKey } from './giftWrap';
import { signGateYes, wrapGateYes, type GateYesSigner } from './gateRequest';
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

/**
 * Answer a kit gate request with the user's own signed yes (see gateRequest.ts).
 * Throws if the signer's reply does not check out or no relay takes the wrap.
 */
export async function publishGateYes(
  signer: GateYesSigner,
  requestId: string,
  threadSecretHex: string,
  opts: ThreadPublishOptions = {},
): Promise<void> {
  const yes = await signGateYes(signer, requestId, opts.nowSec);
  const { event, oneTimeSk } = wrapGateYes(yes, threadSecretHex, opts.nowSec);
  await publishWrap(event, oneTimeSk, opts);
}
