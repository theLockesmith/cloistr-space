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
import { useAllThreads, type StandaloneThread } from '@/services/threads';
import { useThreads } from '@/services/threads';
import { looksLikeNip44 } from '@/services/threads/threadKeyStore';
import { SealedMessagesPanel } from './SealedMessages';

export function ThreadsView() {
  const { threads, groups, standalone, sealedReader, isLoading, error } = useAllThreads();
  const navigate = useNavigate();

  // The project is a filter, not a precondition (operator ruling 2026-10-13):
  // threads outside any project, or in one the user is not in, are threads too.
  const NO_PROJECT = '__none__';
  const [filter, setFilter] = useState<string>('all');
  const [openThread, setOpenThread] = useState<string | null>(null);
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const chips = useMemo(() => {
    const out: { id: string; label: string }[] = groups.map((g) => ({ id: g.id, label: g.name }));
    for (const t of standalone) {
      if (t.projectId && !out.some((c) => c.id === t.projectId)) out.push({ id: t.projectId, label: t.projectId });
    }
    if (standalone.some((t) => !t.projectId)) out.push({ id: NO_PROJECT, label: 'No project' });
    return out;
  }, [groups, standalone]);
  const shownProjectThreads = filter === 'all' ? threads : threads.filter((t) => t.groupId === filter);
  const shownStandalone =
    filter === 'all' ? standalone : standalone.filter((t) => (t.projectId ?? NO_PROJECT) === filter);
  const nothingAtAll = threads.length === 0 && standalone.length === 0;

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
            Longer discussions you can read, in your projects or standing on their own.
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
      {!isLoading && groups.length === 0 && nothingAtAll && (
        <EmptyState
          title="You are not in any projects yet"
          body="Threads live inside a project. Join or create one, and you can start a discussion in it."
          actionLabel="Go to Projects"
          onAction={() => navigate('/projects')}
        />
      )}

      {!isLoading && groups.length > 0 && nothingAtAll && !composing && (
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

      {chips.length > 1 && (
        <div role="group" aria-label="Filter by project" className="flex flex-wrap gap-1.5">
          {[{ id: 'all', label: 'All' }, ...chips].map((c) => (
            <button
              key={c.id}
              aria-pressed={filter === c.id}
              onClick={() => setFilter(c.id)}
              className={`min-h-[36px] rounded-full px-3 text-xs ${
                filter === c.id ? 'bg-cloistr-primary text-cloistr-dark' : 'bg-cloistr-light/5 text-cloistr-light/70 hover:bg-cloistr-light/10'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {shownStandalone.length > 0 && (
        <ul aria-label="Threads outside your projects" className="divide-y divide-cloistr-light/5">
          {shownStandalone.map((t) => (
            <StandaloneRow
              key={t.threadKey}
              thread={t}
              projectLabel={t.projectId ? groupName.get(t.projectId) ?? t.projectId : 'No project'}
              open={openThread === t.threadKey}
              onToggle={() => setOpenThread((cur) => (cur === t.threadKey ? null : t.threadKey))}
            />
          ))}
        </ul>
      )}

      <ul className="divide-y divide-cloistr-light/5">
        {shownProjectThreads.map(({ thread, groupId, groupName }) => (
          <li key={thread.root.id}>
            <button
              onClick={() => navigate(`/projects/${encodeURIComponent(groupId)}`)}
              className="w-full px-1 py-3 text-left hover:bg-cloistr-light/5"
            >
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 rounded bg-cloistr-primary/15 px-1.5 py-0.5 text-xs text-cloistr-primary">
                  {groupName}
                </span>
                {thread.root.sealed && <span className="shrink-0" title="Encrypted thread">🔒</span>}
                <span className="min-w-0 truncate text-sm text-cloistr-light">
                  {thread.root.sealed && looksLikeNip44(thread.root.content)
                    ? thread.root.subject || 'Encrypted thread'
                    : thread.root.subject || thread.root.content.slice(0, 80) || 'Untitled thread'}
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

      <div className="rounded-lg border border-cloistr-light/10">
        <SealedMessagesPanel reader={sealedReader} />
      </div>
    </div>
  );
}

/**
 * A thread with no project page to open, so it opens in place. Only messages
 * acceptStandalone admitted reach here: decrypted with a held key, or the
 * user's own.
 */
function StandaloneRow({
  thread,
  projectLabel,
  open,
  onToggle,
}: {
  thread: StandaloneThread;
  projectLabel: string;
  open: boolean;
  onToggle: () => void;
}) {
  const count = thread.messages.length;
  return (
    <li>
      <button onClick={onToggle} aria-expanded={open} className="w-full px-1 py-3 text-left hover:bg-cloistr-light/5">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 rounded bg-cloistr-light/10 px-1.5 py-0.5 text-xs text-cloistr-light/70">{projectLabel}</span>
          {thread.sealed && <span className="shrink-0" title="Encrypted thread">🔒</span>}
          <span className="min-w-0 truncate text-sm text-cloistr-light">{thread.title}</span>
        </div>
        <div className="mt-1 text-xs text-cloistr-light/50">
          {count} {count === 1 ? 'message' : 'messages'} · <SentAt at={thread.lastActivity} approx={thread.lastActivityApprox} />
        </div>
      </button>
      {open && (
        <ol className="mb-3 space-y-2 pl-3">
          {thread.messages.map((m) => (
            <li key={m.id} className="rounded bg-cloistr-light/5 p-2 text-sm">
              <div className="text-xs text-cloistr-light/50">
                {m.from ?? `${m.pubkey.slice(0, 8)}…`} · <SentAt at={m.createdAt} approx={m.approxTime === true} />
              </div>
              <p className="whitespace-pre-wrap break-words text-cloistr-light/90">{m.text}</p>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/**
 * An approximate time is a wrap's randomised one, up to a day early, so a
 * clock time would be precise-looking and wrong: show the day only.
 */
function SentAt({ at, approx }: { at: number; approx: boolean }) {
  const d = new Date(at * 1000);
  if (!approx) return <>{d.toLocaleString()}</>;
  return <span title="Exact time not recorded by the sender">~{d.toLocaleDateString()}</span>;
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
