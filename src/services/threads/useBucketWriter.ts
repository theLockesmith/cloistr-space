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
 * Core logic lives in threadPublish.ts (React-free). This hook provides the
 * NDK-backed NostrClient adapter.
 */

import { useCallback, useMemo } from 'react';
import { useNdk } from '@/services/nostr';
import type { NostrClient } from '../headless';
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
  const { createEvent, publish, isConnected } = useNdk();
  const canPublish = Boolean(publish && isConnected);

  const client: NostrClient | null = useMemo(() => {
    if (!createEvent || !publish) return null;
    return {
      getPublicKey: async () => '',
      signAndPublish: async () => 0,
      publishSigned: async (raw) => {
        const event = createEvent();
        if (!event) throw new Error('Could not create NDK event');
        event.kind = raw.kind;
        event.content = raw.content;
        event.tags = raw.tags;
        event.created_at = raw.created_at;
        event.pubkey = raw.pubkey;
        event.id = raw.id;
        event.sig = raw.sig;
        const accepted = await publish(event);
        return accepted.size;
      },
      fetch: async () => [],
    };
  }, [createEvent, publish]);

  const sendMessage = useCallback(
    async (
      plaintext: string,
      authorPubkey: string,
      threadSecretHex: string,
      nowSec?: number,
    ) => {
      if (!client) throw new Error('Not connected');
      await publishMessage(client, plaintext, authorPubkey, threadSecretHex, nowSec);
    },
    [client],
  );

  const grantKey = useCallback(
    async (
      threadId: string,
      threadSecretHex: string,
      granterSk: Uint8Array,
      recipientPubkey: string,
      nowSec?: number,
    ) => {
      if (!client) throw new Error('Not connected');
      await publishKeyHandoff(client, threadId, threadSecretHex, granterSk, recipientPubkey, nowSec);
    },
    [client],
  );

  return { sendMessage, grantKey, canPublish };
}
