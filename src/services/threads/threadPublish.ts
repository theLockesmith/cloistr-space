/**
 * Pure thread publish operations, callable without React.
 *
 * Wraps giftWrap.ts (which builds and signs events with one-time keys)
 * and publishes them via a RelayClient. The React hook useBucketWriter
 * delegates here; a headless caller provides its own RelayClient.
 *
 * No SignerInterface needed: gift wraps are signed with one-time keys
 * inside giftWrap.ts, not the user's signer.
 */

import { publishOrThrow, type RelayClient } from '../headless';
import {
  wrapThreadMessage,
  wrapKeyHandoff,
} from './giftWrap';

export async function publishMessage(
  relay: RelayClient,
  plaintext: string,
  authorPubkey: string,
  threadSecretHex: string,
  nowSec?: number,
): Promise<void> {
  const wrap = wrapThreadMessage(plaintext, authorPubkey, threadSecretHex, nowSec);
  await publishOrThrow(relay, wrap);
}

export async function publishKeyHandoff(
  relay: RelayClient,
  threadId: string,
  threadSecretHex: string,
  granterSk: Uint8Array,
  recipientPubkey: string,
  nowSec?: number,
): Promise<void> {
  const wrap = wrapKeyHandoff(threadId, threadSecretHex, granterSk, recipientPubkey, nowSec);
  await publishOrThrow(relay, wrap);
}
