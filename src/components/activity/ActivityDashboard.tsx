import { useState } from 'react';
import { ImportContactsCard, ConflictResolutionPanel } from '@/components/contacts';

export function ActivityDashboard() {
  return (
    <div className="space-y-6">
      {/* Contact sync alerts */}
      <div className="space-y-4">
        <ImportContactsCard />
        <ConflictResolutionPanel maxDisplay={3} />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <QuickAction
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          }
          label="New Document"
          onClick={() => {}}
        />
        <QuickAction
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          }
          label="Upload File"
          onClick={() => {}}
        />
        <QuickAction
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
          label="New Event"
          onClick={() => {}}
        />
        <QuickAction
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
          label="New Task"
          onClick={() => {}}
        />
      </div>

      {/* Dashboard grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent files - spans 2 columns */}
        <div className="lg:col-span-2">
          <RecentFilesWidget />
        </div>

        {/* Tasks */}
        <div>
          <TasksWidget />
        </div>

        {/* Mentions */}
        <div className="lg:col-span-2">
          <MentionsWidget />
        </div>

        {/* Calendar */}
        <div>
          <CalendarWidget />
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4 transition-colors hover:border-cloistr-primary/50 hover:bg-cloistr-primary/10"
    >
      <div className="text-cloistr-primary">{icon}</div>
      <span className="text-sm text-cloistr-light/80">{label}</span>
    </button>
  );
}

function RecentFilesWidget() {
  const [files] = useState([
    { id: '1', name: 'Project Proposal.md', type: 'document', modifiedAt: '2 hours ago' },
    { id: '2', name: 'Budget 2026.xlsx', type: 'spreadsheet', modifiedAt: '5 hours ago' },
    { id: '3', name: 'Meeting Notes.md', type: 'document', modifiedAt: 'Yesterday' },
    { id: '4', name: 'Architecture Diagram.svg', type: 'image', modifiedAt: '2 days ago' },
  ]);

  return (
    <WidgetCard title="Recent Files" action={{ label: 'View all', onClick: () => {} }}>
      <div className="space-y-2">
        {files.map((file) => (
          <div
            key={file.id}
            className="flex items-center justify-between rounded-lg p-3 hover:bg-cloistr-light/5"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cloistr-primary/10 text-cloistr-primary">
                <FileIcon type={file.type} />
              </div>
              <div>
                <p className="text-sm font-medium text-cloistr-light">{file.name}</p>
                <p className="text-xs text-cloistr-light/40">{file.modifiedAt}</p>
              </div>
            </div>
            <button className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}

function TasksWidget() {
  const [tasks] = useState([
    { id: '1', title: 'Review PR #42', completed: false, priority: 'high' as const },
    { id: '2', title: 'Update documentation', completed: false, priority: 'medium' as const },
    { id: '3', title: 'Deploy to staging', completed: true, priority: 'high' as const },
  ]);

  return (
    <WidgetCard title="Tasks" action={{ label: 'Add task', onClick: () => {} }}>
      <div className="space-y-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-3 rounded-lg p-2 hover:bg-cloistr-light/5"
          >
            <input
              type="checkbox"
              checked={task.completed}
              onChange={() => {}}
              className="h-4 w-4 rounded border-cloistr-light/20 bg-transparent text-cloistr-primary focus:ring-cloistr-primary"
            />
            <span
              className={`flex-1 text-sm ${
                task.completed ? 'text-cloistr-light/40 line-through' : 'text-cloistr-light'
              }`}
            >
              {task.title}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs ${
                task.priority === 'high'
                  ? 'bg-red-500/10 text-red-400'
                  : 'bg-yellow-500/10 text-yellow-400'
              }`}
            >
              {task.priority}
            </span>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}

function MentionsWidget() {
  const [mentions] = useState([
    {
      id: '1',
      author: 'npub1abc...',
      content: 'Great work on the relay implementation!',
      createdAt: '1 hour ago',
    },
    {
      id: '2',
      author: 'npub1xyz...',
      content: 'Can you review the NIP-0A changes?',
      createdAt: '3 hours ago',
    },
  ]);

  return (
    <WidgetCard title="Mentions" action={{ label: 'View all', onClick: () => {} }}>
      <div className="space-y-3">
        {mentions.map((mention) => (
          <div key={mention.id} className="rounded-lg border border-cloistr-light/10 p-3">
            <div className="mb-2 flex items-center gap-2">
              <div className="h-6 w-6 rounded-full bg-cloistr-primary/20" />
              <span className="text-sm font-medium text-cloistr-light">{mention.author}</span>
              <span className="text-xs text-cloistr-light/40">{mention.createdAt}</span>
            </div>
            <p className="text-sm text-cloistr-light/80">{mention.content}</p>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}

function CalendarWidget() {
  const [events] = useState([
    { id: '1', title: 'Team Standup', time: '10:00 AM', today: true },
    { id: '2', title: 'Design Review', time: '2:00 PM', today: true },
    { id: '3', title: 'Sprint Planning', time: 'Tomorrow 9:00 AM', today: false },
  ]);

  return (
    <WidgetCard title="Upcoming" action={{ label: 'Calendar', onClick: () => {} }}>
      <div className="space-y-2">
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-center gap-3 rounded-lg p-2 hover:bg-cloistr-light/5"
          >
            <div
              className={`h-2 w-2 rounded-full ${
                event.today ? 'bg-cloistr-primary' : 'bg-cloistr-light/20'
              }`}
            />
            <div className="flex-1">
              <p className="text-sm text-cloistr-light">{event.title}</p>
              <p className="text-xs text-cloistr-light/40">{event.time}</p>
            </div>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}

function WidgetCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-medium text-cloistr-light">{title}</h3>
        {action && (
          <button
            onClick={action.onClick}
            className="text-sm text-cloistr-primary hover:underline"
          >
            {action.label}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function FileIcon({ type }: { type: string }) {
  switch (type) {
    case 'document':
      return (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case 'spreadsheet':
      return (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      );
    default:
      return (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
  }
}
