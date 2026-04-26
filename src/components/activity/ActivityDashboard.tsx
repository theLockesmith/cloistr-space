import { useState, useCallback, useRef, useEffect } from 'react';
import { ImportContactsCard, ConflictResolutionPanel } from '@/components/contacts';
import { useRecentFiles, useTasks, useCalendar, useMentions } from '@/services/activity';
import { useNdk } from '@/services/nostr';
import { getFileType } from '@/types/activity';
import type { FileMetadata, Task, CalendarEvent, Mention } from '@/types/activity';
import { FileUploadModal } from './FileUploadModal';
import { CreateEventModal } from './CreateEventModal';

export function ActivityDashboard() {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);

  const handleOpenUpload = useCallback(() => {
    setIsUploadModalOpen(true);
  }, []);

  const handleCloseUpload = useCallback(() => {
    setIsUploadModalOpen(false);
  }, []);

  const handleUploadComplete = useCallback((url: string, filename: string) => {
    console.log('File uploaded:', { url, filename });
    // The recent files widget will automatically pick up the new file via NDK subscription
  }, []);

  const handleOpenEvent = useCallback(() => {
    setIsEventModalOpen(true);
  }, []);

  const handleCloseEvent = useCallback(() => {
    setIsEventModalOpen(false);
  }, []);

  const handleEventCreated = useCallback(() => {
    console.log('Event created');
    // The calendar widget will automatically pick up the new event via NDK subscription
  }, []);

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
          onClick={handleOpenUpload}
        />
        <QuickAction
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
          label="New Event"
          onClick={handleOpenEvent}
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

      {/* File upload modal */}
      <FileUploadModal
        isOpen={isUploadModalOpen}
        onClose={handleCloseUpload}
        onUploadComplete={handleUploadComplete}
      />

      {/* Create event modal */}
      <CreateEventModal
        isOpen={isEventModalOpen}
        onClose={handleCloseEvent}
        onEventCreated={handleEventCreated}
      />
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
  const isImage = fileType === 'image';
  const thumbnailUrl = file.thumbnail || (isImage ? file.url : null);

  const handleOpen = useCallback(() => {
    window.open(file.url, '_blank', 'noopener,noreferrer');
  }, [file.url]);

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: file.name,
          url: file.url,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(file.url);
    }
  }, [file.name, file.url]);

  const handleDelete = useCallback(() => {
    // TODO: Implement file deletion (requires auth)
    console.log('Delete file:', file.id);
  }, [file.id]);

  return (
    <div className="flex items-center justify-between rounded-lg p-3 hover:bg-cloistr-light/5">
      <div className="flex items-center gap-3">
        {thumbnailUrl ? (
          <div className="h-10 w-10 overflow-hidden rounded-lg bg-cloistr-light/10">
            <img
              src={thumbnailUrl}
              alt={file.name}
              className="h-full w-full object-cover"
              loading="lazy"
              onError={(e) => {
                // Hide image on error, show placeholder
                e.currentTarget.style.display = 'none';
                e.currentTarget.parentElement?.classList.add('flex', 'items-center', 'justify-center', 'text-cloistr-primary', 'bg-cloistr-primary/10');
              }}
            />
          </div>
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cloistr-primary/10 text-cloistr-primary">
            <FileIcon type={fileType} />
          </div>
        )}
        <div>
          <p className="text-sm font-medium text-cloistr-light">{file.name}</p>
          <p className="text-xs text-cloistr-light/60">{timeAgo}</p>
        </div>
      </div>
      <FileActionsMenu onOpen={handleOpen} onShare={handleShare} onDelete={handleDelete} />
    </div>
  );
}

function FileActionsMenu({
  onOpen,
  onShare,
  onDelete,
}: {
  onOpen: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 z-10 mt-1 w-36 rounded-lg border border-cloistr-light/10 bg-cloistr-dark py-1 shadow-lg">
          <button
            onClick={() => {
              onOpen();
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-cloistr-light/80 hover:bg-cloistr-light/5"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Open
          </button>
          <button
            onClick={() => {
              onShare();
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-cloistr-light/80 hover:bg-cloistr-light/5"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Share
          </button>
          <hr className="my-1 border-cloistr-light/10" />
          <button
            onClick={() => {
              onDelete();
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      )}
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
  const { publish, createEvent, isConnected } = useNdk();

  const handleReply = useCallback(async (mention: Mention, content: string) => {
    if (!publish || !createEvent || !isConnected) {
      throw new Error('Not connected');
    }

    const event = createEvent();
    if (!event) throw new Error('Failed to create event');

    event.kind = 1;
    event.content = content;

    // Build reply tags per NIP-10
    const tags: string[][] = [
      // p-tag for the author we're replying to
      ['p', mention.pubkey],
    ];

    // e-tag for the root event (if this mention was part of a thread)
    if (mention.rootEvent) {
      tags.push(['e', mention.rootEvent, '', 'root']);
    } else {
      // If no root, this mention IS the root
      tags.push(['e', mention.id, '', 'root']);
    }

    // e-tag for the direct reply
    tags.push(['e', mention.id, '', 'reply']);

    event.tags = tags;

    await publish(event);
  }, [publish, createEvent, isConnected]);

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
              onReply={(content) => handleReply(mention, content)}
            />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function MentionRow({
  mention,
  onRead,
  onReply,
}: {
  mention: Mention;
  onRead: () => void;
  onReply: (content: string) => Promise<void>;
}) {
  const timeAgo = formatTimeAgo(mention.createdAt);
  const displayName = mention.authorProfile?.displayName || mention.authorProfile?.name || formatPubkey(mention.pubkey);
  const [isReplying, setIsReplying] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleReply = useCallback(async () => {
    if (!replyContent.trim() || isSending) return;
    setIsSending(true);
    try {
      await onReply(replyContent.trim());
      setReplyContent('');
      setIsReplying(false);
    } catch {
      // Error handling done by parent
    } finally {
      setIsSending(false);
    }
  }, [replyContent, isSending, onReply]);

  return (
    <div
      className={`rounded-lg border p-3 ${
        mention.read
          ? 'border-cloistr-light/10'
          : 'border-cloistr-primary/30 bg-cloistr-primary/5'
      }`}
      onClick={onRead}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
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
          <span className="text-xs text-cloistr-light/60">{timeAgo}</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsReplying(!isReplying);
          }}
          className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
          title="Reply"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>
      </div>
      <p className="line-clamp-2 text-sm text-cloistr-light/80">{mention.content}</p>

      {isReplying && (
        <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
          <textarea
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            placeholder="Write a reply..."
            className="w-full resize-none rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light placeholder:text-cloistr-light/40 focus:border-cloistr-primary/50 focus:outline-none"
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setIsReplying(false);
                setReplyContent('');
              }}
              className="rounded px-3 py-1 text-xs text-cloistr-light/60 hover:bg-cloistr-light/5"
            >
              Cancel
            </button>
            <button
              onClick={handleReply}
              disabled={!replyContent.trim() || isSending}
              className="rounded bg-cloistr-primary px-3 py-1 text-xs font-medium text-white hover:bg-cloistr-primary/90 disabled:opacity-50"
            >
              {isSending ? 'Sending...' : 'Reply'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type CalendarViewMode = 'list' | 'day' | 'week';

function CalendarWidget() {
  const { todayEvents, upcomingEvents, isLoading, error, getEventsForDate, getEventsForRange } = useCalendar({ limit: 20, daysAhead: 14 });
  const [viewMode, setViewMode] = useState<CalendarViewMode>('list');
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Get events based on view mode
  const getViewEvents = useCallback(() => {
    if (viewMode === 'day') {
      return getEventsForDate(selectedDate);
    }
    if (viewMode === 'week') {
      const weekStart = new Date(selectedDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week (Sunday)
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return getEventsForRange(weekStart, weekEnd);
    }
    return [...todayEvents, ...upcomingEvents];
  }, [viewMode, selectedDate, getEventsForDate, getEventsForRange, todayEvents, upcomingEvents]);

  const displayEvents = getViewEvents();

  // Navigation handlers
  const navigatePrev = useCallback(() => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      if (viewMode === 'day') {
        next.setDate(next.getDate() - 1);
      } else {
        next.setDate(next.getDate() - 7);
      }
      return next;
    });
  }, [viewMode]);

  const navigateNext = useCallback(() => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      if (viewMode === 'day') {
        next.setDate(next.getDate() + 1);
      } else {
        next.setDate(next.getDate() + 7);
      }
      return next;
    });
  }, [viewMode]);

  const navigateToday = useCallback(() => {
    setSelectedDate(new Date());
  }, []);

  // Format header based on view mode
  const getHeaderText = useCallback(() => {
    if (viewMode === 'list') return 'Upcoming';
    if (viewMode === 'day') {
      return selectedDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    }
    // Week view
    const weekStart = new Date(selectedDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  }, [viewMode, selectedDate]);

  return (
    <WidgetCard
      title={
        <div className="flex items-center gap-2">
          {viewMode !== 'list' && (
            <>
              <button
                onClick={navigatePrev}
                className="rounded p-0.5 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={navigateToday}
                className="rounded px-1.5 py-0.5 text-xs text-cloistr-light/60 hover:bg-cloistr-light/10"
              >
                Today
              </button>
              <button
                onClick={navigateNext}
                className="rounded p-0.5 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}
          <span>{getHeaderText()}</span>
        </div>
      }
      action={{
        label: viewMode === 'list' ? 'Day' : viewMode === 'day' ? 'Week' : 'List',
        onClick: () => setViewMode((v) => (v === 'list' ? 'day' : v === 'day' ? 'week' : 'list')),
      }}
    >
      {isLoading ? (
        <WidgetSkeleton count={3} />
      ) : error ? (
        <WidgetError message={error} />
      ) : displayEvents.length === 0 ? (
        <WidgetEmpty message={viewMode === 'list' ? 'No upcoming events' : 'No events'} />
      ) : (
        <div className="space-y-2">
          {displayEvents.slice(0, 5).map((event) => (
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
        <p className="text-xs text-cloistr-light/60">{timeDisplay}</p>
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
      <p className="text-sm text-cloistr-light/60">{message}</p>
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
