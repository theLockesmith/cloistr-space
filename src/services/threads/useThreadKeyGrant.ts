/**
 * @fileoverview Hook for granting sealed thread access to a new member.
 *
 * When a member is added to a group that uses sealed threads, the admin must
 * publish a key-wrap event (kind 24242) containing the thread's secret key,
 * NIP-44 encrypted to the new member's pubkey. This hook handles that flow.
 *
 * Deliberately standalone rather than wired into useGroupAdmin: group
 * membership and thread key distribution are separate concerns, and keeping
 * them apart makes the grant logic testable without mocking the full group
 * admin stack.
 */

import { useCallback } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuth } from '@/components/auth/AuthProvider';
import { useThreadKeyStore } from './useThreadKeyStore';

interface UseThreadKeyGrantReturn {
  /**
   * Grant a member access to a sealed thread by publishing a key-wrap event.
   *
   * @param threadPubkey   The thread's public key (hex)
   * @param recipientPubkey The new member's public key (hex)
   * @throws When the thread key is not held, the user is not connected, or
   *         the signer does not support NIP-44
   */
  grantKey: (threadPubkey: string, recipientPubkey: string) => Promise<void>;
  /** True when the prerequisites for granting are met (connected, has signer). */
  canGrant: boolean;
}

export function useThreadKeyGrant(): UseThreadKeyGrantReturn {
  const { publish, createEvent, isConnected } = useNdk();
  const { signer } = useAuth();
  const keyStore = useThreadKeyStore();

  const canGrant = Boolean(publish && isConnected && signer);

  const grantKey = useCallback(
    async (threadPubkey: string, recipientPubkey: string) => {
      if (!publish || !createEvent || !isConnected) {
        throw new Error('Not connected');
      }
      if (!signer) {
        throw new Error('No signer available');
      }

      const threadSk = keyStore.get(threadPubkey);
      if (!threadSk) {
        throw new Error(
          `Cannot grant access: thread key not held for ${threadPubkey.slice(0, 8)}...`
        );
      }

      // The signer's secret key is needed for NIP-44 encryption. We ask the
      // signer to encrypt for us rather than extracting the secret key, which
      // NIP-46 signers do not allow. However, buildKeyWrapEvent needs a raw
      // secret key for the conversation key derivation. In a NIP-07/local
      // signer scenario, we can use the signer's nip44Encrypt method instead.
      //
      // For now, we use the signer's nip44Encrypt to encrypt the thread key
      // hex to the recipient, then build the event manually.
      const nip44Encrypt = signer.nip44Encrypt?.bind(signer);
      if (!nip44Encrypt) {
        throw new Error('Signer does not support NIP-44 encryption');
      }

      const { bytesToHex } = await import('nostr-tools/utils');
      const threadSkHex = bytesToHex(threadSk);

      // Encrypt the thread secret key to the recipient
      const encryptedContent = await nip44Encrypt(recipientPubkey, threadSkHex);

      // Build and publish the key-wrap event
      const event = createEvent();
      if (!event) throw new Error('Could not create event');

      event.kind = 24_242;
      event.content = encryptedContent;
      event.tags = [
        ['d', threadPubkey],
        ['p', recipientPubkey],
      ];

      await publish(event);
    },
    [publish, createEvent, isConnected, signer, keyStore]
  );

  return { grantKey, canGrant };
}
