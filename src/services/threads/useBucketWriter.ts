/**
 * @fileoverview Publish sealed thread messages and key handoffs as bucketed gift wraps.
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
  type ThreadRumor,
} from './giftWrap';

export interface BucketWriterReturn {
  /**
   * Wrap a thread message and publish it.
   *
   * The caller builds the ThreadRumor (inner event); this function wraps it
   * in a kind 1059 gift wrap signed by a fresh one-time key and publishes
   * the wrap. The user's signer is NOT used for signing.
   */
  sendMessage: (
    rumor: ThreadRumor,
    threadSecret: Uint8Array,
    windowId?: number,
  ) => Promise<void>;

  /**
   * Wrap a key handoff and publish it.
   *
   * Grants a thread key to a new member. The handoff is bucketed by
   * ECDH(granter, recipient), so only they can find it.
   */
  grantKey: (
    threadSecret: Uint8Array,
    granterSecret: Uint8Array,
    recipientPubkey: string,
    windowId?: number,
  ) => Promise<void>;

  canPublish: boolean;
}

export function useBucketWriter(): BucketWriterReturn {
  const { createEvent, publish, isConnected } = useNdk();
  const canPublish = Boolean(publish && isConnected);

  // Publish a pre-signed event through NDK. Gift wraps are signed by a
  // one-time key (not the user's signer), so we construct an NDKEvent with
  // all fields pre-set. NDK skips signing when sig is already present.
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
    async (rumor: ThreadRumor, threadSecret: Uint8Array, windowId?: number) => {
      const wrap = wrapThreadMessage(rumor, threadSecret, windowId);
      await publishPreSigned(wrap);
    },
    [publishPreSigned],
  );

  const grantKey = useCallback(
    async (
      threadSecret: Uint8Array,
      granterSecret: Uint8Array,
      recipientPubkey: string,
      windowId?: number,
    ) => {
      const wrap = wrapKeyHandoff(
        threadSecret,
        granterSecret,
        recipientPubkey,
        windowId,
      );
      await publishPreSigned(wrap);
    },
    [publishPreSigned],
  );

  return { sendMessage, grantKey, canPublish };
}
