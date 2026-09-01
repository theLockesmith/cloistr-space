/**
 * @fileoverview Edit a project's name, description and picture.
 *
 * useGroupAdmin.updateMetadata was BUILT AND WIRED TO NOTHING -- the guards
 * were right, the wholesale-replacement hazard was handled, and no user could
 * reach any of it. "The function exists" and "a user can do it" are different
 * claims, and the gap between them is invisible from inside a diff.
 *
 * A VISIBLE control, not only a context menu. The operator went looking for a
 * right-click menu, did not find one, and reported the CAPABILITY as missing --
 * which is precisely what a discoverable affordance prevents. Right-click can
 * be added as an accelerator on top; it cannot be the only way in.
 *
 * AFFORDANCE, NOT ENFORCEMENT, exactly as with the member controls: NIP-29 is
 * off on our relay, so nothing server-side checks who may publish a kind:39000.
 * Anyone can publish a replacement for a group they can see. Hiding this from
 * non-admins keeps honest users from doing damage by accident; it stops nobody.
 */

import { useMemo, useState } from 'react';
import { useGroupAdmin } from '@/services/groups/useGroupAdmin';
import { useGroupOwner } from '@/services/groups/useGroupOwner';
import { useGroups } from '@/services/groups/useGroups';

interface Props {
  groupId: string;
  canAdmin: boolean;
}

interface Edits {
  name?: string;
  about?: string;
  picture?: string;
}

export function GroupSettings({ groupId, canAdmin }: Props) {
  const admin = useGroupAdmin(groupId);
  const owner = useGroupOwner(groupId);
  const { groups } = useGroups();
  /**
   * MATCH ON `identifier`, NOT `id`.
   *
   * Group.id is the kind:39000 EVENT id -- a 64-char hash. Group.identifier is
   * the d-tag ("test-project-t9mn5b1"), and the d-tag is what every other part
   * of this surface keys on: ProjectsView passes `group.identifier` as
   * groupId, and the kind:39001/39002 filters use `#d`.
   *
   * Comparing id to a d-tag never matches, so `group` was ALWAYS undefined and
   * the settings form was always blank.
   */
  const group = useMemo(
    () => groups.find((m) => m.group.identifier === groupId)?.group,
    [groups, groupId]
  );

  /**
   * Only what the user has TYPED. The displayed value falls back to the loaded
   * group.
   *
   * Seeding state from props in an effect is the obvious approach and is wrong
   * twice over: it cascades renders (the lint rule objects, correctly), and it
   * would overwrite a half-finished edit the moment a relay echo refreshed the
   * group. Deriving means late-arriving data fills an untouched field and
   * leaves a touched one alone.
   */
  const [edits, setEdits] = useState<Edits>({});

  const name = edits.name ?? group?.name ?? '';
  const about = edits.about ?? group?.description ?? '';
  const picture = edits.picture ?? group?.picture ?? '';

  const setName = (v: string) => setEdits((e) => ({ ...e, name: v }));
  const setAbout = (v: string) => setEdits((e) => ({ ...e, about: v }));
  const setPicture = (v: string) => setEdits((e) => ({ ...e, picture: v }));

  if (!canAdmin) {
    return (
      <div className="p-4 text-sm text-cloistr-light/60">
        Only project admins can change these details.
      </div>
    );
  }

  /**
   * NO FORM WITHOUT THE PROJECT. This is a data-loss guard, not a display one.
   *
   * kind:39000 is addressable, so a save REPLACES the record. A form rendered
   * with blank inputs because the project has not loaded does not merely look
   * wrong -- it asserts "this project has no name", and saving from that state
   * publishes a 39000 with no name tag and WIPES it.
   *
   * A blank field and an unloaded project are different facts, and only one of
   * them is safe to save.
   */
  if (!group) {
    return (
      <div className="p-4">
        <p className="text-sm text-cloistr-light/70">
          Could not load this project's details.
        </p>
        <p className="mt-1 text-xs text-cloistr-light/50">
          Editing is disabled until they load — saving now would replace the project's
          details with empty ones.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-3 p-4">
      <Field label="Name" value={name} onChange={setName} placeholder="Project name" />
      <Field
        label="Description"
        value={about}
        onChange={setAbout}
        placeholder="What is this project for?"
        multiline
      />
      <Field
        label="Picture URL"
        value={picture}
        onChange={setPicture}
        placeholder="https://…"
      />

      {/* kind:39000 is addressable, so a save REPLACES the whole record. Said
          out loud because the form shows three fields and the event carries
          exactly what we put in it -- a field cleared here is cleared there. */}
      <p className="text-xs text-cloistr-light/40">
        Saving replaces the project's details entirely. Anything left blank is removed.
      </p>

      {admin.notice && (
        <p role="status" className="text-xs text-cloistr-light/70">
          {admin.notice}
        </p>
      )}
      {admin.error && (
        <p role="alert" className="text-xs text-cloistr-error">
          {admin.error}
        </p>
      )}

      <button
        onClick={() => void admin.updateMetadata({ name, about, picture })}
        disabled={admin.isBusy || !name.trim()}
        className="rounded bg-cloistr-primary px-4 py-2 text-sm text-cloistr-dark disabled:opacity-50"
      >
        {admin.isBusy ? 'Saving…' : 'Save details'}
      </button>

      {/* Ownership section — transfer for current owner, notice for legacy groups. */}
      {owner.isOwner && (
        <OwnershipTransfer
          onTransfer={(successor) => void owner.transferOwnership(successor)}
          isBusy={owner.isBusy}
          error={owner.error}
          notice={owner.notice}
          onDismiss={owner.dismiss}
        />
      )}
      {!owner.isLoading && owner.ownership?.status === 'legacy' && (
        <div className="border-t border-cloistr-light/10 pt-4">
          <p className="text-xs font-medium text-cloistr-light/60">Ownership</p>
          <p className="mt-1 text-xs text-cloistr-light/40">
            This group was created before ownership verification was introduced. No client
            can determine the owner from the group identifier alone.
          </p>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const className =
    'mt-1 w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light';

  return (
    <label className="block">
      <span className="text-xs text-cloistr-light/60">{label}</span>
      {multiline ? (
        <textarea rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={className} />
      ) : (
        <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={className} />
      )}
    </label>
  );
}

/**
 * Ownership transfer panel, visible only to the current owner.
 *
 * Careful wording. "Only the owner can do this" would overstate what we can
 * promise with NIP-29 off — any key can publish a kind:39000. What we CAN say:
 * this client, and any client that checks the creation event, walks the transfer
 * chain and recognises the result. That is verifiable authority without relay
 * enforcement.
 */
function OwnershipTransfer({
  onTransfer,
  isBusy,
  error,
  notice,
  onDismiss,
}: {
  onTransfer: (successorPubkey: string) => void;
  isBusy: boolean;
  error: string | null;
  notice: string | null;
  onDismiss: () => void;
}) {
  const [successor, setSuccessor] = useState('');
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-cloistr-light/10 pt-4">
      <p className="mb-2 text-xs font-medium text-cloistr-light/60">Ownership</p>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-sm text-cloistr-error/80 hover:text-cloistr-error hover:underline"
        >
          Transfer ownership…
        </button>
      ) : (
        <div className="space-y-3 rounded-lg border border-cloistr-error/20 bg-cloistr-error/5 p-3">
          <p className="text-xs text-cloistr-light/70">
            Ownership is derived from this group's creation event. This client, and
            any client that checks that event, will walk the transfer chain to
            recognise the new owner.
          </p>
          <p className="text-xs text-cloistr-warning">
            Once transferred, reversing this requires the new owner's cooperation.
          </p>
          <Field
            label="New owner (npub or hex pubkey)"
            value={successor}
            onChange={setSuccessor}
            placeholder="npub1… or 64-character hex"
          />
          {notice && (
            <p role="status" className="text-xs text-cloistr-light/70">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-cloistr-error">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => {
                onDismiss();
                onTransfer(successor.trim());
              }}
              disabled={isBusy || !successor.trim()}
              className="rounded bg-cloistr-error px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {isBusy ? 'Transferring…' : 'Transfer ownership'}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setSuccessor('');
                onDismiss();
              }}
              className="rounded px-3 py-1.5 text-sm text-cloistr-light/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
