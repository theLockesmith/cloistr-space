/**
 * @fileoverview Group members component
 * Displays members and admins of a NIP-29 group
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGroupMembers, type GroupMember } from '@/services/groups/useGroupMembers';
import { useGroupAdmin } from '@/services/groups/useGroupAdmin';
import { useAuthorProfiles } from '@/services/profile/useAuthorProfiles';
import { profilePath } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import type { AuthorProfile } from '@/types/social';

interface GroupMembersProps {
  groupId: string;
}

export function GroupMembers({ groupId }: GroupMembersProps) {
  const { members, isLoading, error, refresh } = useGroupMembers(groupId);
  const { pubkey } = useAuthStore();

  /**
   * Whether to offer admin controls.
   *
   * Derived from the member list rather than passed in, because that list is
   * the only thing that knows, and threading a prop through GroupWorkspace
   * would just move the same lookup somewhere with less information.
   *
   * Fails CLOSED: a failed or still-loading read yields false, so the controls
   * are hidden rather than offered and then refused.
   *
   * This is a UI affordance, NOT enforcement. Our relay does not run relay29,
   * so nothing server-side checks who may publish a kind:39002 -- any key
   * holder can. Hiding the buttons keeps honest users from doing damage by
   * accident; it does not stop anyone.
   */
  const canAdmin = Boolean(pubkey && members.some((m) => m.pubkey === pubkey && m.isAdmin));

  // The member list rendered raw hex, which cannot serve its only purpose --
  // you cannot recognise anyone by it. Resolved through the same batched hook
  // the feed uses rather than a second fetch inside useGroupMembers.
  const pubkeys = useMemo(() => members.map((m) => m.pubkey), [members]);
  const profiles = useAuthorProfiles(pubkeys);

  const admin = useGroupAdmin(groupId);
  const [adding, setAdding] = useState(false);
  const [newPubkey, setNewPubkey] = useState('');

  const admins = members.filter((m) => m.isAdmin);
  const regularMembers = members.filter((m) => !m.isAdmin);

  const submitAdd = async () => {
    await admin.addMember(newPubkey.trim());
    setNewPubkey('');
    setAdding(false);
    refresh();
  };

  const doRemove = async (pubkey: string) => {
    await admin.removeMember(pubkey);
    refresh();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cloistr-light/10 px-4 py-3">
        <h3 className="font-medium text-cloistr-light">
          Members {!isLoading && <span className="text-cloistr-light/60">({members.length})</span>}
        </h3>
        <button
          onClick={refresh}
          className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
          title="Refresh"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {canAdmin && (
        <div className="border-b border-cloistr-light/10 px-4 py-3">
          {adding ? (
            <div className="space-y-2">
              <input
                type="text"
                value={newPubkey}
                onChange={(e) => setNewPubkey(e.target.value)}
                placeholder="npub1… or 64-character hex key"
                className="w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => void submitAdd()}
                  disabled={admin.isBusy || !newPubkey.trim()}
                  className="rounded bg-cloistr-primary px-3 py-1.5 text-sm text-cloistr-dark disabled:opacity-50"
                >
                  {admin.isBusy ? 'Adding…' : 'Add'}
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setNewPubkey('');
                  }}
                  className="rounded px-3 py-1.5 text-sm text-cloistr-light/60"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="text-sm text-cloistr-primary hover:underline"
            >
              + Add member
            </button>
          )}

          {/* A refusal is not an error, and it is said out loud. "Nothing
              happened" after pressing Add is how someone concludes the feature
              is broken and keeps pressing it. */}
          {admin.notice && (
            <p role="status" className="mt-2 text-xs text-cloistr-light/70">
              {admin.notice}
            </p>
          )}
          {admin.error && (
            <p role="alert" className="mt-2 text-xs text-cloistr-error">
              {admin.error}
            </p>
          )}
        </div>
      )}

      {/* Members list */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-cloistr-light/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 rounded bg-cloistr-light/10" />
                  <div className="h-3 w-1/4 rounded bg-cloistr-light/10" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-cloistr-error">{error}</p>
              <button
                onClick={refresh}
                className="mt-2 text-xs text-cloistr-primary underline hover:no-underline"
              >
                Try again
              </button>
            </div>
          </div>
        ) : members.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-cloistr-light/60">No members found</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Admins section */}
            {admins.length > 0 && (
              <div>
                <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-cloistr-light/60">
                  Admins ({admins.length})
                </h4>
                <div className="space-y-2">
                  {admins.map((member) => (
                    <MemberRow
                      key={member.pubkey}
                      member={member}
                      profile={profiles.get(member.pubkey) ?? member.profile}
                      canAdmin={canAdmin}
                      isBusy={admin.isBusy}
                      onRemove={() => void doRemove(member.pubkey)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Members section */}
            {regularMembers.length > 0 && (
              <div>
                <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-cloistr-light/60">
                  Members ({regularMembers.length})
                </h4>
                <div className="space-y-2">
                  {regularMembers.map((member) => (
                    <MemberRow
                      key={member.pubkey}
                      member={member}
                      profile={profiles.get(member.pubkey) ?? member.profile}
                      canAdmin={canAdmin}
                      isBusy={admin.isBusy}
                      onRemove={() => void doRemove(member.pubkey)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MemberRow({
  member,
  profile,
  canAdmin,
  isBusy,
  onRemove,
}: {
  member: GroupMember;
  /**
   * Resolved from kind:0, falling back to whatever the member object already
   * carries. Same shape as SocialFeed: a caller that already has profile data
   * should not be forced through a second lookup to display it.
   */
  profile?: AuthorProfile;
  canAdmin: boolean;
  isBusy: boolean;
  onRemove: () => void;
}) {
  const displayName = profile?.displayName || profile?.name || formatPubkey(member.pubkey);
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-cloistr-light/5">
      {profile?.picture ? (
        <img
          src={profile.picture}
          alt=""
          className="h-10 w-10 rounded-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cloistr-primary/20 text-sm font-medium text-cloistr-primary">
          {initials}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            to={profilePath(member.pubkey)}
            className="truncate text-sm font-medium text-cloistr-light hover:underline"
          >
            {displayName}
          </Link>
          {member.isAdmin && (
            <span className="rounded bg-cloistr-primary/20 px-1.5 py-0.5 text-xs text-cloistr-primary">
              Admin
            </span>
          )}
        </div>
        {profile?.nip05 && (
          <p className="truncate text-xs text-cloistr-light/60">{profile.nip05}</p>
        )}
        {member.isAdmin && member.permissions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {member.permissions.slice(0, 3).map((perm) => (
              <span
                key={perm}
                className="rounded bg-cloistr-light/10 px-1.5 py-0.5 text-xs text-cloistr-light/60"
              >
                {formatPermission(perm)}
              </span>
            ))}
            {member.permissions.length > 3 && (
              <span className="text-xs text-cloistr-light/60">
                +{member.permissions.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>

      {canAdmin && (
        <button
          onClick={onRemove}
          disabled={isBusy}
          aria-label={`Remove ${displayName}`}
          className="shrink-0 rounded px-2 py-1 text-xs text-cloistr-light/40 hover:bg-cloistr-error/10 hover:text-cloistr-error disabled:opacity-40"
        >
          Remove
        </button>
      )}
    </div>
  );
}

function formatPubkey(pubkey: string): string {
  return pubkey.slice(0, 8) + '...' + pubkey.slice(-4);
}

function formatPermission(permission: string): string {
  return permission
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
