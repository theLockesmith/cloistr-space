/**
 * @fileoverview Top-level Threads: find a discussion across every group.
 *
 * The in-project tab is where you read a thread. This is the door. Threads
 * previously existed only inside /projects/:groupId, so a user who had not
 * selected a project saw no trace of them and reasonably concluded the feature
 * had not shipped.
 */

import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAllThreads } from '@/services/threads';
import { useThreads } from '@/services/threads';

export function ThreadsView() {
  const { threads, groups, isLoading, error } = useAllThreads();
  const navigate = useNavigate();

  const [composing, setComposing] = useState(false);
  const [targetGroup, setTargetGroup] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // Default the picker to the user's only group when there is exactly one --
  // making someone choose from a list of one is a step that carries no
  // information.
  const defaultGroup = groups.length === 1 ? groups[0].id : '';
  const selectedGroup = targetGroup || defaultGroup;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-cloistr-light">Threads</h1>
          <p className="mt-1 text-sm text-cloistr-light/60">
            Longer discussions from your projects, kept separate from the chat.
          </p>
        </div>
        {groups.length > 0 && (
          <button
            onClick={() => setComposing((c) => !c)}
            className="shrink-0 rounded bg-cloistr-primary px-3 py-1.5 text-sm text-cloistr-dark"
          >
            {composing ? 'Cancel' : 'New thread'}
          </button>
        )}
      </div>

      {composing && selectedGroup && (
        <NewThreadForm
          groupId={selectedGroup}
          groups={groups}
          onGroupChange={setTargetGroup}
          subject={subject}
          body={body}
          onSubject={setSubject}
          onBody={setBody}
          onDone={() => {
            setComposing(false);
            setSubject('');
            setBody('');
          }}
        />
      )}

      {error && (
        <div className="rounded-lg border border-cloistr-error/30 bg-cloistr-error/5 p-3 text-sm text-cloistr-light/80">
          {error}
        </div>
      )}

      {isLoading && <p className="text-sm text-cloistr-light/50">Loading threads…</p>}

      {/* Two different empties, said differently.
          A blank panel is how Threads read as not-shipped last time, and "no
          threads" would be a lie to someone who has no groups to hold one. */}
      {!isLoading && groups.length === 0 && (
        <EmptyState
          title="You are not in any projects yet"
          body="Threads live inside a project. Join or create one, and you can start a discussion in it."
          actionLabel="Go to Projects"
          onAction={() => navigate('/projects')}
        />
      )}

      {!isLoading && groups.length > 0 && threads.length === 0 && !composing && (
        <EmptyState
          title="No threads yet"
          body={
            groups.length === 1
              ? `Nothing has been discussed in ${groups[0].name} yet. Start the first thread.`
              : `Nothing has been discussed in your ${groups.length} projects yet. Start the first thread.`
          }
          actionLabel="New thread"
          onAction={() => setComposing(true)}
        />
      )}

      <ul className="divide-y divide-cloistr-light/5">
        {threads.map(({ thread, groupId, groupName }) => (
          <li key={thread.root.id}>
            <button
              onClick={() => navigate(`/projects/${encodeURIComponent(groupId)}`)}
              className="w-full px-1 py-3 text-left hover:bg-cloistr-light/5"
            >
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 rounded bg-cloistr-primary/15 px-1.5 py-0.5 text-xs text-cloistr-primary">
                  {groupName}
                </span>
                <span className="min-w-0 truncate text-sm text-cloistr-light">
                  {thread.root.subject || thread.root.content.slice(0, 80) || 'Untitled thread'}
                </span>
              </div>
              <div className="mt-1 text-xs text-cloistr-light/50">
                {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'} ·{' '}
                {new Date(thread.lastActivity * 1000).toLocaleString()}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-8 text-center">
      <h3 className="mb-2 font-medium text-cloistr-light">{title}</h3>
      <p className="mx-auto mb-4 max-w-md text-sm text-cloistr-light/60">{body}</p>
      <button
        onClick={onAction}
        className="rounded bg-cloistr-primary px-4 py-2 text-sm text-cloistr-dark"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function NewThreadForm({
  groupId,
  groups,
  onGroupChange,
  subject,
  body,
  onSubject,
  onBody,
  onDone,
}: {
  groupId: string;
  groups: { id: string; name: string }[];
  onGroupChange: (id: string) => void;
  subject: string;
  body: string;
  onSubject: (v: string) => void;
  onBody: (v: string) => void;
  onDone: () => void;
}) {
  // Posting is group-scoped, so the composer uses the single-group hook with
  // whichever group is selected. Remounting on change is intentional: it binds
  // the publish to the group actually chosen rather than one captured earlier.
  const { createThread } = useThreads(groupId);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canPost = useMemo(() => Boolean(subject.trim() || body.trim()), [subject, body]);

  const submit = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      await createThread(subject, body);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not post the thread.');
    } finally {
      setBusy(false);
    }
  }, [createThread, subject, body, onDone]);

  return (
    <div className="space-y-2 rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-4">
      {groups.length > 1 && (
        <label className="block">
          <span className="text-xs text-cloistr-light/60">Project</span>
          <select
            value={groupId}
            onChange={(e) => onGroupChange(e.target.value)}
            className="mt-1 w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <input
        type="text"
        value={subject}
        placeholder="Subject"
        onChange={(e) => onSubject(e.target.value)}
        className="w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
      />
      <textarea
        rows={4}
        value={body}
        placeholder="What do you want to discuss?"
        onChange={(e) => onBody(e.target.value)}
        className="w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
      />

      {err && <p className="text-xs text-cloistr-error">{err}</p>}

      <button
        onClick={() => void submit()}
        disabled={busy || !canPost}
        className="rounded bg-cloistr-primary px-4 py-2 text-sm text-cloistr-dark disabled:opacity-50"
      >
        {busy ? 'Posting…' : 'Post thread'}
      </button>
    </div>
  );
}
