/**
 * Full-screen overlay that surfaces a signer connectivity failure WITHOUT
 * destroying the session.
 *
 * WHY THIS EXISTS
 *
 * A relay hiccup or a missed NIP-46 approval used to send the user to the
 * login screen. That is wrong on two levels:
 *   1. The session was still valid — only the relay path was temporarily down.
 *   2. Asking for credentials teaches users that a network blip means "prove
 *      who you are again", the exact habit a key-based product must not build.
 *
 * This component reads signerError from AuthProvider. That error is set on
 * signing failures and on a failed session restore, in both cases without
 * touching the session. AuthGuard still passes (isAuthenticated stays true),
 * and this overlay renders on top, offering Retry and Go back — never a
 * credential prompt.
 *
 * WHAT "GO BACK" MEANS HERE
 *
 * Clearing the error dismisses the overlay. The user is still in the app with
 * a valid session. Anything that requires the signer will fail again until they
 * Retry, which reconnects the NIP-46 signer before resuming.
 */
import { useCallback, useState } from 'react';
import { SignerRecovery } from '@cloistr/ui/components';
import { useAuth } from './AuthProvider';
import { useNdk } from '@/services/nostr';

export function SignerErrorOverlay() {
  const { signerError, clearSignerError, retrySignerConnection } = useAuth();
  const { reconnect } = useNdk();
  const [retrying, setRetrying] = useState(false);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      // Reconnect NDK relay sockets and re-establish the signer session in
      // parallel. reconnect() handles the relay layer; retrySignerConnection()
      // handles the NIP-46 handshake. Both must succeed before signing works.
      await Promise.all([reconnect(), retrySignerConnection()]);
    } finally {
      setRetrying(false);
    }
  }, [reconnect, retrySignerConnection]);

  if (!signerError) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{ maxWidth: '28rem', width: '100%', padding: '0 1rem' }}>
        <SignerRecovery
          error={signerError}
          retrying={retrying}
          onRetry={handleRetry}
          onGoBack={clearSignerError}
        />
      </div>
    </div>
  );
}
