import { ImportContactsCard, ConflictResolutionPanel } from '@/components/contacts';
import { useRecentFiles, useTasks, useCalendar, useMentions } from '@/services/activity';
import { getFileType } from '@/types/activity';
import type { FileMetadata, Task, CalendarEvent, Mention } from '@/types/activity';

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
  const { items: files, isLoading, error } = useRecentFiles({ limit: 5 });

  return (
    <WidgetCard title="Recent Files" action={{ label: 'View all', onClick: () => {} }}>
      {isLoading ? (
        <WidgetSkeleton count={4} />
      ) : error ? (
        <WidgetError message={error} />
      ) : files.length === 0 ? (
        <WidgetEmpty message="No recent files" />
      ) : (
        <div className="space-y-2">
          {files.map((file) => (
            <FileRow key={file.id} file={file} />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function FileRow({ file }: { file: FileMetadata }) {
  const fileType = getFileType(file.mimeType);
  const timeAgo = formatTimeAgo(file.createdAt);

  return (
    <div className="flex items-center justify-between rounded-lg p-3 hover:bg-cloistr-light/5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cloistr-primary/10 text-cloistr-primary">
          <FileIcon type={fileType} />
        </div>
        <div>
          <p className="text-sm font-medium text-cloistr-light">{file.name}</p>
          <p className="text-xs text-cloistr-light/40">{timeAgo}</p>
        </div>
      </div>
      <button className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>
    </div>
  );
}

function TasksWidget() {
  const { items: tasks, isLoading, error, toggleTask } = useTasks({ limit: 5 });

  return (
    <WidgetCard title="Tasks" action={{ label: 'Add task', onClick: () => {} }}>
      {isLoading ? (
        <WidgetSkeleton count={3} />
      ) : error ? (
        <WidgetError message={error} />
      ) : tasks.length === 0 ? (
        <WidgetEmpty message="No tasks" />
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task.identifier)} />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function TaskRow({ task, onToggle }: { task: Task; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg p-2 hover:bg-cloistr-light/5">
      <input
        type="checkbox"
        checked={task.completed}
        onChange={onToggle}
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
            : task.priority === 'low'
              ? 'bg-gray-500/10 text-gray-400'
              : 'bg-yellow-500/10 text-yellow-400'
        }`}
      >
        {task.priority}
      </span>
    </div>
  );
}

function MentionsWidget() {
  const { items: mentions, isLoading, error, markAsRead, unreadCount } = useMentions({ limit: 5 });

  return (
    <WidgetCard
      title={
        <span className="flex items-center gap-2">
          Mentions
          {unreadCount > 0 && (
            <span className="rounded-full bg-cloistr-primary px-2 py-0.5 text-xs text-white">
              {unreadCount}
            </span>
          )}
        </span>
      }
      action={{ label: 'View all', onClick: () => {} }}
    >
      {isLoading ? (
        <WidgetSkeleton count={2} />
      ) : error ? (
        <WidgetError message={error} />
      ) : mentions.length === 0 ? (
        <WidgetEmpty message="No mentions" />
      ) : (
        <div className="space-y-3">
          {mentions.map((mention) => (
            <MentionRow
              key={mention.id}
              mention={mention}
              onRead={() => markAsRead(mention.id)}
            />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function MentionRow({ mention, onRead }: { mention: Mention; onRead: () => void }) {
  const timeAgo = formatTimeAgo(mention.createdAt);
  const displayName = mention.authorProfile?.displayName || mention.authorProfile?.name || formatPubkey(mention.pubkey);

  return (
    <div
      className={`rounded-lg border p-3 ${
        mention.read
          ? 'border-cloistr-light/10'
          : 'border-cloistr-primary/30 bg-cloistr-primary/5'
      }`}
      onClick={onRead}
    >
      <div className="mb-2 flex items-center gap-2">
        {mention.authorProfile?.picture ? (
          <img
            src={mention.authorProfile.picture}
            alt=""
            className="h-6 w-6 rounded-full"
          />
        ) : (
          <div className="h-6 w-6 rounded-full bg-cloistr-primary/20" />
        )}
        <span className="text-sm font-medium text-cloistr-light">{displayName}</span>
        <span className="text-xs text-cloistr-light/40">{timeAgo}</span>
      </div>
      <p className="line-clamp-2 text-sm text-cloistr-light/80">{mention.content}</p>
    </div>
  );
}

function CalendarWidget() {
  const { todayEvents, upcomingEvents, isLoading, error } = useCalendar({ limit: 5 });

  const allEvents = [...todayEvents, ...upcomingEvents];

  return (
    <WidgetCard title="Upcoming" action={{ label: 'Calendar', onClick: () => {} }}>
      {isLoading ? (
        <WidgetSkeleton count={3} />
      ) : error ? (
        <WidgetError message={error} />
      ) : allEvents.length === 0 ? (
        <WidgetEmpty message="No upcoming events" />
      ) : (
        <div className="space-y-2">
          {allEvents.map((event) => (
            <CalendarRow key={event.id} event={event} isToday={todayEvents.includes(event)} />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function CalendarRow({ event, isToday }: { event: CalendarEvent; isToday: boolean }) {
  const timeDisplay = formatEventTime(event);

  return (
    <div className="flex items-center gap-3 rounded-lg p-2 hover:bg-cloistr-light/5">
      <div
        className={`h-2 w-2 rounded-full ${
          isToday ? 'bg-cloistr-primary' : 'bg-cloistr-light/20'
        }`}
      />
      <div className="flex-1">
        <p className="text-sm text-cloistr-light">{event.title}</p>
        <p className="text-xs text-cloistr-light/40">{timeDisplay}</p>
      </div>
    </div>
  );
}

// ============================================
// Shared Components
// ============================================

function WidgetCard({
  title,
  action,
  children,
}: {
  title: React.ReactNode;
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

function WidgetSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3">
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

function WidgetError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-center">
      <p className="text-sm text-red-400">{message}</p>
    </div>
  );
}

function WidgetEmpty({ message }: { message: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm text-cloistr-light/40">{message}</p>
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
    case 'image':
      return (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
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

// ============================================
// Utility Functions
// ============================================

function formatTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

function formatEventTime(event: CalendarEvent): string {
  const date = new Date(event.startTime * 1000);
  const now = new Date();

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const isTomorrow =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate() + 1;

  const timeStr = event.allDay
    ? 'All day'
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (isToday) return timeStr;
  if (isTomorrow) return `Tomorrow ${timeStr}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;
}

function formatPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}...`;
}
