/**
 * @fileoverview Group list component
 * Displays user's NIP-29 groups with membership status
 */

import { useGroups } from '@/services/groups';
import type { GroupMembership } from '@/types/groups';

interface GroupListProps {
  onSelectGroup: (groupId: string) => void;
  selectedGroupId?: string;
}

export function GroupList({ onSelectGroup, selectedGroupId }: GroupListProps) {
  const { groups, isLoading, error, refresh } = useGroups();

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex animate-pulse items-center gap-3 rounded-lg p-3">
            <div className="h-10 w-10 rounded-lg bg-cloistr-light/10" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-cloistr-light/10" />
              <div className="h-3 w-1/2 rounded bg-cloistr-light/10" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={refresh}
            className="mt-2 text-xs text-red-400 underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-cloistr-light/10">
            <svg className="h-6 w-6 text-cloistr-light/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h3 className="mb-2 font-medium text-cloistr-light">No groups yet</h3>
          <p className="text-sm text-cloistr-light/60">
            Join or create a group to collaborate with others
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1 p-2">
      {groups.map((membership) => (
        <GroupRow
          key={membership.group.identifier}
          membership={membership}
          isSelected={selectedGroupId === membership.group.identifier}
          onClick={() => onSelectGroup(membership.group.identifier)}
        />
      ))}
    </div>
  );
}

function GroupRow({
  membership,
  isSelected,
  onClick,
}: {
  membership: GroupMembership;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { group, isAdmin } = membership;

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors ${
        isSelected
          ? 'bg-cloistr-primary/20 text-cloistr-light'
          : 'text-cloistr-light/80 hover:bg-cloistr-light/5'
      }`}
    >
      {group.picture ? (
        <img
          src={group.picture}
          alt=""
          className="h-10 w-10 rounded-lg object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cloistr-primary/10 text-cloistr-primary">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{group.name}</span>
          {isAdmin && (
            <span className="rounded bg-cloistr-primary/20 px-1.5 py-0.5 text-xs text-cloistr-primary">
              Admin
            </span>
          )}
        </div>
        {group.description && (
          <p className="truncate text-xs text-cloistr-light/40">{group.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1">
        {group.isPublic ? (
          <svg className="h-4 w-4 text-cloistr-light/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className="h-4 w-4 text-cloistr-light/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        )}
      </div>
    </button>
  );
}
