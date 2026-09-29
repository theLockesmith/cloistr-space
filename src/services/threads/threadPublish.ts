/**
 * Pure thread publish operations, callable without React.
 *
 * Wraps giftWrap.ts (which builds and signs events with one-time keys)
 * and publishes them via a NostrClient. The React hook useBucketWriter
 * delegates here; a headless caller provides its own NostrClient.
 */

import type { NostrClient } from '../headless';
import {
  wrapThreadMessage,
  wrapKeyHandoff,
} from './giftWrap';

export async function publishMessage(
  client: NostrClient,
  plaintext: string,
  authorPubkey: string,
  threadSecretHex: string,
  nowSec?: number,
): Promise<void> {
  const wrap = wrapThreadMessage(plaintext, authorPubkey, threadSecretHex, nowSec);
  await client.publishSigned(wrap);
}

export async function publishKeyHandoff(
  client: NostrClient,
  threadId: string,
  threadSecretHex: string,
  granterSk: Uint8Array,
  recipientPubkey: string,
  nowSec?: number,
): Promise<void> {
  const wrap = wrapKeyHandoff(threadId, threadSecretHex, granterSk, recipientPubkey, nowSec);
  await client.publishSigned(wrap);
}
