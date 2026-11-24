/**
 * @fileoverview Hand a private thread's key to a member, from the UI.
 *
 * The hand-off is a bucketed gift wrap (threadPublish.publishKeyHandoffViaSigner)
 * that waits on the relays for the member, so the member need not be online.
 * The granter's key stays in their signer: only `cloistr_ecdh_tag` is asked
 * of it. Browser-extension (NIP-07) sign-in has no such method, so it cannot
 * grant, the same limit as reading hand-offs.
 *
 * Every grant is recorded so useHandoffResender can send it again each day
 * for a while: one send lasts about two days on the relays.
 */

import { useCallback, useEffect } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthStore } from '@/stores/authStore';
import type { SignerInterface } from '@cloistr/auth';
import { useThreadKeyStore } from './useThreadKeyStore';
import { publishKeyHandoffViaSigner } from './threadPublish';
import { openHandoffGrants } from './handoffGrants';
import { resendDueHandoffs } from './resendHandoffs';
import { getWindowId } from './bucketCrypto';

interface UseThreadKeyGrantReturn {
  /**
   * Send `memberPubkey` the key of the held thread `threadPubkey`.
   *
   * @throws When the key or its thread id is not held, the signer cannot
   *         give the hand-off mailbox, or no relay takes the wrap.
   */
  grantKey: (threadPubkey: string, memberPubkey: string) => Promise<void>;
  /** False for sign-in methods that cannot work out the mailbox (NIP-07). */
  canGrant: boolean;
}

function canWorkOutMailbox(signer: SignerInterface | null | undefined): signer is SignerInterface {
  return typeof (signer as { sendRequest?: unknown } | null | undefined)?.sendRequest === 'function';
}

function selfCrypt(signer: SignerInterface) {
  const encrypt = signer.nip44Encrypt?.bind(signer);
  const decrypt = signer.nip44Decrypt?.bind(signer);
  return encrypt && decrypt ? { encrypt, decrypt } : null;
}

export function useThreadKeyGrant(): UseThreadKeyGrantReturn {
  const { signer } = useAuth();
  const pubkey = useAuthStore((s) => s.pubkey);
  const keyStore = useThreadKeyStore();

  const canGrant = Boolean(pubkey) && canWorkOutMailbox(signer);

  const grantKey = useCallback(
    async (threadPubkey: string, memberPubkey: string) => {
      if (!pubkey || !canWorkOutMailbox(signer)) {
        throw new Error('This sign-in method cannot hand over thread keys.');
      }
      const secret = keyStore.exportHex(threadPubkey);
      const tid = keyStore.getName(threadPubkey);
      if (!secret || !tid) {
        throw new Error('You do not hold this thread’s key.');
      }

      const now = Math.floor(Date.now() / 1000);
      await publishKeyHandoffViaSigner(tid, secret, signer, memberPubkey, { nowSec: now });

      const crypt = selfCrypt(signer);
      if (!crypt) return;
      const grants = await openHandoffGrants(pubkey, crypt, () => useAuthStore.getState().pubkey === pubkey);
      await grants.record(threadPubkey, memberPubkey, tid, getWindowId(now));
    },
    [pubkey, signer, keyStore],
  );

  return { grantKey, canGrant };
}

/**
 * Re-send this user's recent hand-offs that have not gone out today. Mounted
 * once, in MainLayout, so any page counts as "having Space open". Runs again
 * when a key arrives, because saved keys restore after the first run.
 */
export function useHandoffResender(): void {
  const { signer } = useAuth();
  const pubkey = useAuthStore((s) => s.pubkey);
  const keyStore = useThreadKeyStore();

  useEffect(() => {
    if (!pubkey || !canWorkOutMailbox(signer)) return;
    const crypt = selfCrypt(signer);
    if (!crypt) return;

    let cancelled = false;
    let running = false;
    let again = false;
    const grantsP = openHandoffGrants(pubkey, crypt, () => useAuthStore.getState().pubkey === pubkey);

    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          const grants = await grantsP;
          if (cancelled || useAuthStore.getState().pubkey !== pubkey) return;
          await resendDueHandoffs(grants, keyStore, signer);
        } while (again && !cancelled);
      } finally {
        running = false;
      }
    };

    void run();
    const off = keyStore.onKeyAdded(() => void run());
    return () => {
      cancelled = true;
      off();
    };
  }, [pubkey, signer, keyStore]);
}
