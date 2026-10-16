/**
 * @fileoverview "Finish setting up this project", for an owner whose project
 * creation stopped partway. See services/groups/projectSetup.ts for when it is
 * safe; this component only shows what that check decided.
 *
 * Shown only when the check says unfinished. When a relay did not answer it
 * says so instead of offering the button, because a member list may be on that
 * relay and the button would replace it.
 */

import { useProjectSetup } from '@/services/groups/useProjectSetup';

export function FinishProjectSetup({ groupId }: { groupId: string }) {
  const { check, finish, isBusy, error, notice } = useProjectSetup(groupId);

  const status = check?.status;
  if (status !== 'unfinished' && status !== 'unchecked' && !notice && !error) return null;

  return (
    <div className="rounded-lg border border-cloistr-warning/30 bg-cloistr-warning/5 p-3">
      {status === 'unfinished' && (
        <>
          <p className="text-sm text-cloistr-light/80">
            Setting up this project did not finish, so it has no member list yet and members
            cannot be added.
          </p>
          <button
            onClick={() => void finish()}
            disabled={isBusy}
            className="mt-2 rounded bg-cloistr-primary px-3 py-1.5 text-sm text-cloistr-dark disabled:opacity-50"
          >
            {isBusy ? 'Finishing…' : 'Finish setting up this project'}
          </button>
        </>
      )}
      {status === 'unchecked' && (
        <p className="text-sm text-cloistr-light/70">
          Not all of your relays answered, so this project can't be checked right now. Try again
          later.
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 text-xs text-cloistr-light/70">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-cloistr-error">
          {error}
        </p>
      )}
    </div>
  );
}
