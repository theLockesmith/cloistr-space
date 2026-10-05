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
 * Core logic lives in threadPublish.ts (React-free, accepts RelayClient).
 * This hook provides the NDK-backed adapter.
 */

import { useCallback } from 'react';
import { useNdk, useHeadlessAdapters } from '@/services/nostr';
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

  const { relay } = useHeadlessAdapters();

  const sendMessage = useCallback(
    async (
      plaintext: string,
      authorPubkey: string,
      threadSecretHex: string,
      nowSec?: number,
    ) => {
      if (!relay) throw new Error('Not connected');
      await publishMessage(relay, plaintext, authorPubkey, threadSecretHex, nowSec);
    },
    [relay],
  );

  const grantKey = useCallback(
    async (
      threadId: string,
      threadSecretHex: string,
      granterSk: Uint8Array,
      recipientPubkey: string,
      nowSec?: number,
    ) => {
      if (!relay) throw new Error('Not connected');
      await publishKeyHandoff(relay, threadId, threadSecretHex, granterSk, recipientPubkey, nowSec);
    },
    [relay],
  );

  return { sendMessage, grantKey, canPublish };
}
