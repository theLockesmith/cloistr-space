/**
 * @fileoverview Group workspace component
 * Container for group chat, files, and members with tab navigation
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { GroupChat } from './GroupChat';
import { GroupThreads } from './GroupThreads';
import { GroupFiles } from './GroupFiles';
import { GroupMembers } from './GroupMembers';
import { GroupSettings } from './GroupSettings';
import { useGroupMembers } from '@/services/groups/useGroupMembers';
import { useAuthStore } from '@/stores/authStore';
import { useGroupActions } from '@/services/groups/useGroupActions';

type Tab = 'chat' | 'threads' | 'files' | 'members' | 'settings';

interface GroupWorkspaceProps {
  groupId: string;
  groupName: string;
  onLeaveGroup?: () => void;
}

export function GroupWorkspace({ groupId, groupName, onLeaveGroup }: GroupWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  // Same derivation as GroupMembers, and it fails CLOSED: a failed or
  // still-loading member read hides the tab rather than offering a control that
  // will refuse. See GroupSettings for why this is an affordance, not
  // enforcement.
  const { pubkey } = useAuthStore();
  const { members } = useGroupMembers(groupId);
  const canAdmin = Boolean(pubkey && members.some((m) => m.pubkey === pubkey && m.isAdmin));
  const { leaveGroup, canAct } = useGroupActions();
  const [showMenu, setShowMenu] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);

  const handleLeave = useCallback(async () => {
    if (!canAct || isLeaving) return;

    if (!confirm('Are you sure you want to leave this group?')) return;

    setIsLeaving(true);
    try {
      await leaveGroup(groupId);
      onLeaveGroup?.();
    } catch (err) {
      console.error('Failed to leave group:', err);
    } finally {
      setIsLeaving(false);
      setShowMenu(false);
    }
  }, [canAct, isLeaving, leaveGroup, groupId, onLeaveGroup]);

  return (
    <div className="flex h-full flex-col">
      {/* Header with tabs */}
      <div className="border-b border-cloistr-light/10">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="font-semibold text-cloistr-light">{groupName}</h2>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
              aria-label="More options"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-cloistr-light/10 bg-cloistr-dark py-1 shadow-lg">
                <button
                  onClick={handleLeave}
                  disabled={!canAct || isLeaving}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-cloistr-error hover:bg-cloistr-error/10 disabled:opacity-50"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  {isLeaving ? 'Leaving...' : 'Leave group'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4">
          <TabButton
            label="Chat"
            icon={<ChatIcon />}
            isActive={activeTab === 'chat'}
            onClick={() => setActiveTab('chat')}
          />
          {/* Beside Chat rather than above it: threads are group-scoped by
              construction, so a top-level Threads section would need a group
              picker as its first interaction, which is Projects with extra
              steps. */}
          <TabButton
            label="Threads"
            icon={<ThreadsIcon />}
            isActive={activeTab === 'threads'}
            onClick={() => setActiveTab('threads')}
          />
          <TabButton
            label="Files"
            icon={<FilesIcon />}
            isActive={activeTab === 'files'}
            onClick={() => setActiveTab('files')}
          />
          <TabButton
            label="Members"
            icon={<MembersIcon />}
            isActive={activeTab === 'members'}
            onClick={() => setActiveTab('members')}
          />
          {/* Only shown to admins, and it is the VISIBLE route to editing a
              project. updateMetadata existed with zero callers until this. */}
          {canAdmin && (
            <TabButton
              label="Settings"
              icon={<SettingsIcon />}
              isActive={activeTab === 'settings'}
              onClick={() => setActiveTab('settings')}
            />
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'chat' && (
          <GroupChat groupId={groupId} groupName={groupName} />
        )}
        {activeTab === 'threads' && (
          <GroupThreads groupId={groupId} />
        )}
        {activeTab === 'files' && (
          <GroupFiles groupId={groupId} />
        )}
        {activeTab === 'settings' && (
          <GroupSettings groupId={groupId} canAdmin={canAdmin} />
        )}
        {activeTab === 'members' && (
          <GroupMembers groupId={groupId} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  label,
  icon,
  isActive,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        isActive
          ? 'border-cloistr-primary text-cloistr-primary'
          : 'border-transparent text-cloistr-light/60 hover:text-cloistr-light'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ChatIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function ThreadsIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h7" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function MembersIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}
