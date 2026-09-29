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

import { useCallback, useMemo } from 'react';
import { useNdk } from '@/services/nostr';
import type { RelayClient } from '../headless';
import type { Event } from 'nostr-tools';
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

  const relay: RelayClient | null = useMemo(() => {
    if (!createEvent || !publish) return null;
    return {
      publish: async (raw: Event) => {
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
