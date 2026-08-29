/**
 * @fileoverview Offer to restore a contact list Space overwrote.
 *
 * Deliberately not automatic. Restoring someone's contact list is a visible act
 * on their own published data, and they should see what is coming back and from
 * when before it happens.
 */

import { useState } from 'react';
import { useContactsSync } from '@/services/crdt';

export function RecoverContactsCard() {
  const { recovery, applyRecovery } = useContactsSync({ autoSync: false });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!recovery || done) return null;

  const restoredDate = new Date(recovery.restoredFrom * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const handleRestore = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await applyRecovery();
      if (ok) setDone(true);
      else setError('The restore could not be published. Check your relay connection.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The restore failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-cloistr-warning/40 bg-cloistr-warning/10 p-4">
      <h3 className="text-sm font-medium text-cloistr-light">
        We found an earlier version of your contact list
      </h3>
      <p className="mt-1 text-sm text-cloistr-light/70">
        Your list here is empty, but a version from {restoredDate} with{' '}
        {recovery.contactCount} {recovery.contactCount === 1 ? 'contact' : 'contacts'} is still on
        your relay. This app replaced it with an empty one — that was our bug, and it can be undone.
      </p>
      <p className="mt-2 text-xs text-cloistr-light/50">
        Restoring merges those contacts back in. Anything you have followed since is kept.
      </p>

      {error && <p className="mt-2 text-xs text-cloistr-error">{error}</p>}

      <button
        onClick={() => void handleRestore()}
        disabled={busy}
        className="mt-3 rounded bg-cloistr-primary px-4 py-2 text-sm text-cloistr-dark disabled:opacity-50"
      >
        {busy ? 'Restoring…' : `Restore ${recovery.contactCount} contacts`}
      </button>
    </div>
  );
}
