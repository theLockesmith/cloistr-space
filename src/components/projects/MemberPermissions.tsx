/**
 * @fileoverview Set one member's role, or their individual permissions.
 *
 * Roles are the primary control because that is what people are looking for --
 * "make them an admin" -- and the individual permissions sit underneath
 * because the data already carries them and coercing an unusual set into the
 * nearest role would destroy what another client wrote.
 *
 * "Custom" is a DESCRIPTION, never a choice. It appears when the permissions
 * match no preset, which is an honest report rather than a state you assign.
 */

import { useState } from 'react';
import {
  ALL_PERMISSIONS,
  PERMISSION_LABEL,
  ROLE_LABEL,
  permissionEditRefusal,
  permissionsForRole,
  roleFor,
  togglePermission,
  PERMISSION_REFUSAL_MESSAGE,
  type Role,
} from '@/services/groups/permissions';
import type { AdminPermission } from '@/types/groups';

interface Props {
  targetPubkey: string;
  targetName: string;
  permissions: AdminPermission[];
  editorPubkey: string | null;
  editorPermissions: AdminPermission[];
  /**
   * The group's current owner pubkey, derived from the creation event.
   * When provided, the owner's permissions cannot be changed by non-owners.
   */
  ownerPubkey?: string;
  isBusy: boolean;
  onApply: (permissions: AdminPermission[]) => void;
  onClose: () => void;
}

export function MemberPermissions({
  targetPubkey,
  targetName,
  permissions,
  editorPubkey,
  editorPermissions,
  ownerPubkey,
  isBusy,
  onApply,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<AdminPermission[]>(permissions);
  const role = roleFor(draft);

  const refusal = permissionEditRefusal(editorPubkey, editorPermissions, targetPubkey, draft, ownerPubkey);
  const changed =
    draft.length !== permissions.length || draft.some((p) => !permissions.includes(p));

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-3">
      <p className="text-xs text-cloistr-light/60">
        Permissions for <span className="text-cloistr-light">{targetName}</span>
      </p>

      <div className="flex flex-wrap gap-1">
        {(['admin', 'moderator', 'member'] as const).map((r) => (
          <button
            key={r}
            onClick={() => setDraft(permissionsForRole(r))}
            className={`rounded px-2 py-1 text-xs ${
              role === r
                ? 'bg-cloistr-primary text-cloistr-dark'
                : 'bg-cloistr-light/5 text-cloistr-light/70 hover:bg-cloistr-light/10'
            }`}
          >
            {ROLE_LABEL[r]}
          </button>
        ))}
        {/* Shown, not selectable. It reports what the permissions ARE. */}
        {role === 'custom' && (
          <span className="rounded bg-cloistr-light/10 px-2 py-1 text-xs text-cloistr-light/60">
            {ROLE_LABEL.custom}
          </span>
        )}
      </div>

      <div className="space-y-1">
        {ALL_PERMISSIONS.map((p) => (
          <label key={p} className="flex items-center gap-2 text-xs text-cloistr-light/80">
            <input
              type="checkbox"
              checked={draft.includes(p)}
              onChange={() => setDraft((d) => togglePermission(d, p))}
            />
            {PERMISSION_LABEL[p]}
          </label>
        ))}
      </div>

      {/* A refusal is stated before it can be attempted, not after. */}
      {refusal && (
        <p role="status" className="text-xs text-cloistr-warning">
          {PERMISSION_REFUSAL_MESSAGE[refusal]}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onApply(draft)}
          disabled={isBusy || refusal !== null || !changed}
          className="rounded bg-cloistr-primary px-3 py-1.5 text-xs text-cloistr-dark disabled:opacity-50"
        >
          {isBusy ? 'Saving…' : 'Apply'}
        </button>
        <button onClick={onClose} className="rounded px-3 py-1.5 text-xs text-cloistr-light/60">
          Cancel
        </button>
      </div>
    </div>
  );
}

export type { Role };
