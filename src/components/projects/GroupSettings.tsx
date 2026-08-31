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
  const { groups } = useGroups();
  // useGroups yields GroupMembership, not Group -- the group is nested inside.
  const group = useMemo(
    () => groups.find((m) => m.group.id === groupId)?.group,
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
