/**
 * @fileoverview Group workspace component
 * Container for group chat, files, and members with tab navigation
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { GroupChat } from './GroupChat';
import { GroupFiles } from './GroupFiles';
import { GroupMembers } from './GroupMembers';
import { useGroupActions } from '@/services/groups/useGroupActions';

type Tab = 'chat' | 'files' | 'members';

interface GroupWorkspaceProps {
  groupId: string;
  groupName: string;
  onLeaveGroup?: () => void;
}

export function GroupWorkspace({ groupId, groupName, onLeaveGroup }: GroupWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
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
              className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
              title="More options"
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
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
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
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'chat' && (
          <GroupChat groupId={groupId} groupName={groupName} />
        )}
        {activeTab === 'files' && (
          <GroupFiles groupId={groupId} />
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

function FilesIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
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
