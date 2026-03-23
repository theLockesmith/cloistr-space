import { useState } from 'react';
import { useParams } from 'react-router-dom';

export function ProjectsView() {
  const { groupId } = useParams();

  if (groupId) {
    return <GroupDetail groupId={groupId} />;
  }

  return <GroupsList />;
}

function GroupsList() {
  const [groups] = useState([
    {
      id: 'abc123',
      name: 'Cloistr Development',
      picture: null,
      memberCount: 12,
      unreadCount: 3,
      lastActivity: '5 minutes ago',
    },
    {
      id: 'def456',
      name: 'Nostr Protocol',
      picture: null,
      memberCount: 156,
      unreadCount: 0,
      lastActivity: '1 hour ago',
    },
    {
      id: 'ghi789',
      name: 'Bitcoin Builders',
      picture: null,
      memberCount: 42,
      unreadCount: 7,
      lastActivity: '30 minutes ago',
    },
  ]);

  return (
    <div className="space-y-6">
      {/* Header with create button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-cloistr-light">Your Groups</h2>
          <p className="text-sm text-cloistr-light/60">NIP-29 relay-based groups</p>
        </div>
        <button className="flex items-center gap-2 rounded-lg bg-cloistr-primary px-4 py-2 text-sm font-medium text-white hover:bg-cloistr-primary/90">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Create Group
        </button>
      </div>

      {/* Groups grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <a
            key={group.id}
            href={`/projects/${group.id}`}
            className="group rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4 transition-colors hover:border-cloistr-primary/50"
          >
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-cloistr-primary/20 text-cloistr-primary">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-cloistr-light group-hover:text-cloistr-primary">
                  {group.name}
                </h3>
                <p className="text-xs text-cloistr-light/40">{group.memberCount} members</p>
              </div>
              {group.unreadCount > 0 && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-cloistr-accent px-1.5 text-xs font-medium text-black">
                  {group.unreadCount}
                </span>
              )}
            </div>
            <p className="text-xs text-cloistr-light/40">Active {group.lastActivity}</p>
          </a>
        ))}
      </div>

      {/* Join group section */}
      <div className="rounded-lg border border-dashed border-cloistr-light/20 p-6 text-center">
        <svg
          className="mx-auto h-8 w-8 text-cloistr-light/40"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-cloistr-light">Join a Group</h3>
        <p className="mt-1 text-xs text-cloistr-light/40">
          Enter an invite code or group address
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <input
            type="text"
            placeholder="Invite code or naddr..."
            className="w-64 rounded-lg border border-cloistr-light/20 bg-transparent px-3 py-2 text-sm text-cloistr-light placeholder-cloistr-light/40 focus:border-cloistr-primary focus:outline-none"
          />
          <button className="rounded-lg bg-cloistr-light/10 px-4 py-2 text-sm text-cloistr-light hover:bg-cloistr-light/20">
            Join
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupDetail({ groupId: _groupId }: { groupId: string }) {
  // TODO: Fetch group data using _groupId
  const [activeTab, setActiveTab] = useState<'chat' | 'files' | 'members'>('chat');

  return (
    <div className="space-y-4">
      {/* Group header */}
      <div className="flex items-center gap-4">
        <a
          href="/projects"
          className="rounded-lg p-2 text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </a>
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-cloistr-primary/20 text-cloistr-primary">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-medium text-cloistr-light">Cloistr Development</h2>
          <p className="text-sm text-cloistr-light/40">12 members</p>
        </div>
        <button className="rounded-lg p-2 text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-1">
        {(['chat', 'files', 'members'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'bg-cloistr-primary text-white'
                : 'text-cloistr-light/60 hover:text-cloistr-light'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-[400px] rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4">
        {activeTab === 'chat' && (
          <div className="flex h-full flex-col">
            <div className="flex-1 space-y-4">
              <p className="text-center text-sm text-cloistr-light/40">
                Group chat will be displayed here
              </p>
            </div>
            <div className="mt-4 flex gap-2">
              <input
                type="text"
                placeholder="Type a message..."
                className="flex-1 rounded-lg border border-cloistr-light/20 bg-transparent px-4 py-2 text-sm text-cloistr-light placeholder-cloistr-light/40 focus:border-cloistr-primary focus:outline-none"
              />
              <button className="rounded-lg bg-cloistr-primary px-4 py-2 text-sm font-medium text-white hover:bg-cloistr-primary/90">
                Send
              </button>
            </div>
          </div>
        )}
        {activeTab === 'files' && (
          <p className="text-center text-sm text-cloistr-light/40">
            Group files will be displayed here (Drive integration)
          </p>
        )}
        {activeTab === 'members' && (
          <p className="text-center text-sm text-cloistr-light/40">
            Group members will be displayed here
          </p>
        )}
      </div>
    </div>
  );
}
