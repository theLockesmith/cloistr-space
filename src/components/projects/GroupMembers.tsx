/**
 * @fileoverview Group members component
 * Displays members and admins of a NIP-29 group
 */

import { useGroupMembers, type GroupMember } from '@/services/groups/useGroupMembers';

interface GroupMembersProps {
  groupId: string;
}

export function GroupMembers({ groupId }: GroupMembersProps) {
  const { members, isLoading, error, refresh } = useGroupMembers(groupId);

  const admins = members.filter((m) => m.isAdmin);
  const regularMembers = members.filter((m) => !m.isAdmin);

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
              <p className="text-sm text-red-400">{error}</p>
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
                    <MemberRow key={member.pubkey} member={member} />
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
                    <MemberRow key={member.pubkey} member={member} />
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

function MemberRow({ member }: { member: GroupMember }) {
  const displayName = member.profile?.displayName || member.profile?.name || formatPubkey(member.pubkey);
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-cloistr-light/5">
      {member.profile?.picture ? (
        <img
          src={member.profile.picture}
          alt=""
          className="h-10 w-10 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cloistr-primary/20 text-sm font-medium text-cloistr-primary">
          {initials}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-cloistr-light">{displayName}</span>
          {member.isAdmin && (
            <span className="rounded bg-cloistr-primary/20 px-1.5 py-0.5 text-xs text-cloistr-primary">
              Admin
            </span>
          )}
        </div>
        {member.profile?.nip05 && (
          <p className="truncate text-xs text-cloistr-light/60">{member.profile.nip05}</p>
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
