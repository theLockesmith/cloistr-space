/**
 * @fileoverview Projects view
 * Main view for NIP-29 group workspaces
 */

import { useState, useCallback } from 'react';
import { GroupList } from './GroupList';
import { GroupWorkspace } from './GroupWorkspace';
import { GroupBrowser } from './GroupBrowser';
import { CreateGroupModal } from './CreateGroupModal';
import { useGroups } from '@/services/groups';

export function ProjectsView() {
  const { groups, refresh } = useGroups();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);

  const selectedGroup = groups.find((g) => g.group.identifier === selectedGroupId);

  const handleSelectGroup = useCallback((groupId: string) => {
    setSelectedGroupId(groupId);
  }, []);

  const handleOpenCreateModal = useCallback(() => {
    setIsCreateModalOpen(true);
  }, []);

  const handleCloseCreateModal = useCallback(() => {
    setIsCreateModalOpen(false);
  }, []);

  const handleGroupCreated = useCallback((groupId: string) => {
    refresh();
    setSelectedGroupId(groupId);
  }, [refresh]);

  const handleLeaveGroup = useCallback(() => {
    refresh();
    setSelectedGroupId(null);
  }, [refresh]);

  const handleJoinGroup = useCallback((groupId: string) => {
    refresh();
    setSelectedGroupId(groupId);
    setShowBrowser(false);
  }, [refresh]);

  return (
    <div className="flex h-full">
      {/* Sidebar - Group list */}
      <div className="w-64 flex-shrink-0 border-r border-cloistr-light/10 overflow-y-auto">
        <div className="flex items-center justify-between border-b border-cloistr-light/10 px-4 py-3">
          <h2 className="font-semibold text-cloistr-light">Projects</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowBrowser(true)}
              className="rounded p-1 text-cloistr-light/60 hover:bg-cloistr-light/10 hover:text-cloistr-light"
              title="Browse groups"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
            <button
              onClick={handleOpenCreateModal}
              className="rounded p-1 text-cloistr-primary hover:bg-cloistr-primary/10"
              title="Create group"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </button>
          </div>
        </div>
        <GroupList
          onSelectGroup={handleSelectGroup}
          selectedGroupId={selectedGroupId || undefined}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {showBrowser ? (
          <GroupBrowser
            onJoinGroup={handleJoinGroup}
            onClose={() => setShowBrowser(false)}
          />
        ) : selectedGroup ? (
          <GroupWorkspace
            groupId={selectedGroup.group.identifier}
            groupName={selectedGroup.group.name}
            onLeaveGroup={handleLeaveGroup}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-cloistr-light/10">
                <svg className="h-8 w-8 text-cloistr-light/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="mb-2 font-medium text-cloistr-light">Select a project</h3>
              <p className="text-sm text-cloistr-light/60">
                Choose a project from the sidebar to view chat and files
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Create group modal */}
      <CreateGroupModal
        isOpen={isCreateModalOpen}
        onClose={handleCloseCreateModal}
        onGroupCreated={handleGroupCreated}
      />
    </div>
  );
}
