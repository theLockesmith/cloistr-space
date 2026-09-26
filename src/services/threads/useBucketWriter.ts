/**
 * Publish sealed thread messages and key handoffs as bucketed gift wraps.
 *
 * Each message is wrapped under a one-time key, encrypted to the thread,
 * and tagged with a bucket that rotates daily. The relay sees a kind 1059
 * event signed by a key it has never seen before, carrying one opaque tag.
 *
 * Key handoffs carry the thread's secret key encrypted to the recipient,
 * bucketed by a value only the granter and recipient can compute.
 */

import { useCallback } from 'react';
import { useNdk } from '@/services/nostr';
import {
  wrapThreadMessage,
  wrapKeyHandoff,
} from './giftWrap';

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
  const { createEvent, publish, isConnected } = useNdk();
  const canPublish = Boolean(publish && isConnected);

  const publishPreSigned = useCallback(
    async (raw: {
      id: string;
      pubkey: string;
      created_at: number;
      kind: number;
      tags: string[][];
      content: string;
      sig: string;
    }) => {
      if (!createEvent || !publish) throw new Error('Not connected');

      const event = createEvent();
      if (!event) throw new Error('Could not create NDK event');

      event.kind = raw.kind;
      event.content = raw.content;
      event.tags = raw.tags;
      event.created_at = raw.created_at;
      event.pubkey = raw.pubkey;
      event.id = raw.id;
      event.sig = raw.sig;

      await publish(event);
    },
    [createEvent, publish],
  );

  const sendMessage = useCallback(
    async (
      plaintext: string,
      authorPubkey: string,
      threadSecretHex: string,
      nowSec?: number,
    ) => {
      const wrap = wrapThreadMessage(plaintext, authorPubkey, threadSecretHex, nowSec);
      await publishPreSigned(wrap);
    },
    [publishPreSigned],
  );

  const grantKey = useCallback(
    async (
      threadId: string,
      threadSecretHex: string,
      granterSk: Uint8Array,
      recipientPubkey: string,
      nowSec?: number,
    ) => {
      const wrap = wrapKeyHandoff(threadId, threadSecretHex, granterSk, recipientPubkey, nowSec);
      await publishPreSigned(wrap);
    },
    [publishPreSigned],
  );

  return { sendMessage, grantKey, canPublish };
}
