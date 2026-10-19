/**
 * Publish sealed thread messages and key handoffs as bucketed gift wraps.
 *
 * Each message is wrapped under a one-time key, encrypted to the thread,
 * and tagged with a bucket that rotates daily. The relay sees a kind 1059
 * event signed by a key it has never seen before, carrying one opaque tag.
 *
 * Key handoffs carry the thread's secret key encrypted to the recipient,
 * bucketed by a value only the granter and recipient can compute.
 *
 * Core logic lives in threadPublish.ts (React-free). Each wrap is sent on a
 * connection of its own, signed in as its one-time key, never the user's NDK
 * connection; see wrapRelay.ts.
 */

import { useCallback } from 'react';
import { useNdk } from '@/services/nostr';
import {
  publishMessage,
  publishKeyHandoff,
} from './threadPublish';

export interface BucketWriterReturn {
  sendMessage: (
    plaintext: string,
    authorPubkey: string,
    threadSecretHex: string,
    nowSec?: number,
  ) => Promise<void>;

  grantKey: (
    threadId: string,
    threadSecretHex: string,
    granterSk: Uint8Array,
    recipientPubkey: string,
    nowSec?: number,
  ) => Promise<void>;

  canPublish: boolean;
}

export function useBucketWriter(): BucketWriterReturn {
  const { publish, isConnected } = useNdk();
  const canPublish = Boolean(publish && isConnected);

  const sendMessage = useCallback(
    async (
      plaintext: string,
      authorPubkey: string,
      threadSecretHex: string,
      nowSec?: number,
    ) => {
      await publishMessage(plaintext, authorPubkey, threadSecretHex, { nowSec });
    },
    [],
  );

  const grantKey = useCallback(
    async (
      threadId: string,
      threadSecretHex: string,
      granterSk: Uint8Array,
      recipientPubkey: string,
      nowSec?: number,
    ) => {
      await publishKeyHandoff(threadId, threadSecretHex, granterSk, recipientPubkey, { nowSec });
    },
    [],
  );

  return { sendMessage, grantKey, canPublish };
}
