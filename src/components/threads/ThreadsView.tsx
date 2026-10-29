/**
 * @fileoverview The one thread list (threads.md 6).
 *
 * Public and private threads interleave by last activity; private ones carry
 * a lock. There is no separate Sealed tab: key offers wait at the top of the
 * list and each private thread has its own reply box. The same screen is a
 * project's Threads tab, fixed to that project.
 *
 * Archived threads leave the active list and appear under the Archived filter
 * and in search. Search is client-side over what the list already holds
 * (Q11 is unruled).
 */

import { useState, useCallback, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useHeadlessAdapters } from '@/services/nostr';
import {
  useAllThreads,
  createPublicThread,
  matchesSearch,
  type PublicThreadItem,
  type StandaloneThread,
} from '@/services/threads';
import { KeyOffers, shortNpub } from './sealedParts';
import { PublicThreadDetail, PrivateThreadDetail, SentAt } from './ThreadDetail';

const NO_PROJECT = '__none__';

type Row =
  | { kind: 'public'; key: string; lastActivity: number; item: PublicThreadItem }
  | { kind: 'private'; key: string; lastActivity: number; thread: StandaloneThread };

function privateMatches(thread: StandaloneThread, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return thread.title.toLowerCase().includes(q) || thread.messages.some((m) => m.text.toLowerCase().includes(q));
}

/**
 * @param groupId When set, the list is that project's threads only: the
 *   project's Threads tab. New threads then go into that project.
 */
export function ThreadsView({ groupId }: { groupId?: string } = {}) {
  const { publicThreads, privateThreads, groups, sealedReader, isLoading, error } = useAllThreads();
  const { pubkey } = useAuthStore();

  // The project is a filter, not a precondition (operator ruling 2026-10-13).
  const [filter, setFilter] = useState<string>('all');
  const [archivedView, setArchivedView] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const projectFilter = groupId ?? filter;
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const projectLabel = (id: string | null) => (id ? groupName.get(id) ?? id : 'No project');

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [
      ...publicThreads.map((item): Row => ({
        kind: 'public',
        key: `public:${item.thread.root.id}`,
        lastActivity: item.thread.lastActivity,
        item,
      })),
      ...privateThreads.map((thread): Row => ({
        kind: 'private',
        key: thread.threadKey,
        lastActivity: thread.lastActivity,
        thread,
      })),
    ];
    return out.sort((a, b) => b.lastActivity - a.lastActivity);
  }, [publicThreads, privateThreads]);

  const projectOf = (r: Row) => (r.kind === 'public' ? r.item.groupId : r.thread.projectId);
  const inProject = (r: Row) => projectFilter === 'all' || (projectOf(r) ?? NO_PROJECT) === projectFilter;
  const isArchived = (r: Row) => r.kind === 'public' && r.item.thread.status === 'archived';
  const searching = query.trim() !== '';

  // A search covers archived threads too: archived means out of the active
  // list, not out of reach.
  const shown = rows.filter(
    (r) =>
      inProject(r) &&
      (searching
        ? r.kind === 'public'
          ? matchesSearch(r.item, query)
          : privateMatches(r.thread, query)
        : isArchived(r) === archivedView),
  );
  const scoped = rows.filter(inProject);
  const archivedCount = scoped.filter(isArchived).length;

  const chips = useMemo(() => {
    const out: { id: string; label: string }[] = groups.map((g) => ({ id: g.id, label: g.name }));
    for (const r of rows) {
      const p = r.kind === 'public' ? r.item.groupId : r.thread.projectId;
      if (p && !out.some((c) => c.id === p)) out.push({ id: p, label: p });
    }
    if (rows.some((r) => !(r.kind === 'public' ? r.item.groupId : r.thread.projectId))) {
      out.push({ id: NO_PROJECT, label: 'No project' });
    }
    return out;
  }, [groups, rows]);

  const opened = open ? rows.find((r) => r.key === open) : undefined;
  if (opened) {
    const back = () => setOpen(null);
    return (
      <Shell embedded={Boolean(groupId)}>
        {opened.kind === 'public' ? (
          <PublicThreadDetail item={opened.item} onBack={back} />
        ) : (
          <PrivateThreadDetail thread={opened.thread} onBack={back} />
        )}
      </Shell>
    );
  }

  return (
    <Shell embedded={Boolean(groupId)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-cloistr-light">Threads</h1>
          <p className="mt-1 text-sm text-cloistr-light/60">
            {groupId
              ? 'Longer discussions in this project.'
              : 'Longer discussions, public or private, in your projects or standing on their own.'}
          </p>
        </div>
        {pubkey && (
          <button
            onClick={() => setComposing((c) => !c)}
            className="shrink-0 rounded bg-cloistr-primary px-3 py-1.5 text-sm text-cloistr-dark"
          >
            {composing ? 'Cancel' : 'New thread'}
          </button>
        )}
      </div>

      <KeyOffers reader={sealedReader} />

      {/* Without this, a reader that never looked renders exactly like a user
          nobody has shared a thread with. */}
      {sealedReader.handoffLookupUnavailable && (
        <div role="alert" className="rounded-lg border border-cloistr-error/30 bg-cloistr-error/5 p-3 text-sm text-cloistr-light/80">
          Space could not look for private threads shared with you: your signer session cannot locate thread
          keys. Private threads you have opened here before still show; new ones will not until this is fixed.
        </div>
      )}

      {composing && (
        <NewThreadForm
          fixedGroup={groupId}
          groups={groups}
          initialGroup={groupId ?? (filter !== 'all' && filter !== NO_PROJECT ? filter : groups.length === 1 ? groups[0].id : undefined)}
          onDone={() => setComposing(false)}
        />
      )}

      {error && (
        <div className="rounded-lg border border-cloistr-error/30 bg-cloistr-error/5 p-3 text-sm text-cloistr-light/80">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          placeholder="Search threads"
          aria-label="Search threads"
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
        />
        <div role="group" aria-label="Show" className="flex gap-1">
          {[
            { archived: false, label: 'Active' },
            { archived: true, label: archivedCount ? `Archived (${archivedCount})` : 'Archived' },
          ].map((o) => (
            <button
              key={o.label}
              aria-pressed={!searching && archivedView === o.archived}
              onClick={() => setArchivedView(o.archived)}
              className={`min-h-[36px] rounded-full px-3 text-xs ${
                !searching && archivedView === o.archived
                  ? 'bg-cloistr-primary text-cloistr-dark'
                  : 'bg-cloistr-light/5 text-cloistr-light/70 hover:bg-cloistr-light/10'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {!groupId && chips.length > 1 && (
        <div role="group" aria-label="Filter by project" className="flex flex-wrap gap-1.5">
          {[{ id: 'all', label: 'All' }, ...chips].map((c) => (
            <button
              key={c.id}
              aria-pressed={filter === c.id}
              onClick={() => setFilter(c.id)}
              className={`min-h-[36px] rounded-full px-3 text-xs ${
                filter === c.id
                  ? 'bg-cloistr-primary text-cloistr-dark'
                  : 'bg-cloistr-light/5 text-cloistr-light/70 hover:bg-cloistr-light/10'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {isLoading && <p className="text-sm text-cloistr-light/50">Loading threads…</p>}

      {/* Each empty says which empty it is: a blank panel is how Threads read
          as not-shipped once already. */}
      {!isLoading && shown.length === 0 && (
        <p className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-6 text-center text-sm text-cloistr-light/60">
          {searching
            ? `No threads match “${query.trim()}”.`
            : archivedView
              ? 'No archived threads.'
              : scoped.length > 0
                ? 'No active threads. Archived ones are under Archived.'
                : groupId
                  ? 'Nothing has been discussed in this project yet.'
                  : sealedReader.handoffLookupUnavailable
                    ? 'No threads found, but private ones may be missing (see above).'
                    : 'No threads yet. Start one in a project, or on its own.'}
        </p>
      )}

      {shown.length > 0 && (
        <ul aria-label="Threads" className="divide-y divide-cloistr-light/5">
          {shown.map((r) => (
            <ThreadRow
              key={r.key}
              row={r}
              projectLabel={groupId ? null : projectLabel(projectOf(r))}
              onOpen={() => setOpen(r.key)}
            />
          ))}
        </ul>
      )}
    </Shell>
  );
}

function Shell({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
  return (
    <div className={embedded ? 'h-full overflow-auto' : undefined}>
      <div className="mx-auto max-w-3xl space-y-4 p-4">{children}</div>
    </div>
  );
}

function ThreadRow({ row, projectLabel, onOpen }: { row: Row; projectLabel: string | null; onOpen: () => void }) {
  const title =
    row.kind === 'public'
      ? row.item.thread.root.subject || row.item.thread.root.content.slice(0, 80) || 'Untitled thread'
      : row.thread.title;
  const archived = row.kind === 'public' && row.item.thread.status === 'archived';

  return (
    <li>
      <button onClick={onOpen} className="w-full px-1 py-3 text-left hover:bg-cloistr-light/5">
        <div className="flex items-baseline gap-2">
          {projectLabel && (
            <span className="shrink-0 rounded bg-cloistr-light/10 px-1.5 py-0.5 text-xs text-cloistr-light/70">
              {projectLabel}
            </span>
          )}
          {row.kind === 'private' && (
            <span className="shrink-0" title="Private thread" aria-label="Private thread">
              🔒
            </span>
          )}
          <span className="min-w-0 truncate text-sm text-cloistr-light">{title}</span>
          {archived && <span className="shrink-0 text-xs text-cloistr-warning">Archived</span>}
        </div>
        <div className="mt-1 text-xs text-cloistr-light/50">
          {row.kind === 'public' ? (
            <>
              {/* The root's signer. Private rows name nobody: a v1 sealed
                  sender is a claim, and the list is no place to present one
                  as the thread's author (threads.md 6). */}
              <span className="font-mono">{shortNpub(row.item.thread.root.pubkey)}</span> ·{' '}
              {row.item.thread.replyCount} {row.item.thread.replyCount === 1 ? 'reply' : 'replies'} ·{' '}
              <SentAt at={row.lastActivity} approx={false} />
            </>
          ) : (
            <>
              {row.thread.messages.length} {row.thread.messages.length === 1 ? 'message' : 'messages'} ·{' '}
              <SentAt at={row.lastActivity} approx={row.thread.lastActivityApprox} />
            </>
          )}
        </div>
      </button>
    </li>
  );
}

/**
 * A new public thread. Private threads need members and a grant through the
 * signer, which is P4; until then this form says plainly that what it posts
 * is public.
 */
function NewThreadForm({
  fixedGroup,
  groups,
  initialGroup,
  onDone,
}: {
  fixedGroup?: string;
  groups: { id: string; name: string }[];
  initialGroup?: string;
  onDone: () => void;
}) {
  const { signer, relay } = useHeadlessAdapters();
  // undefined = not chosen yet. Choosing "no project" is a real choice, and
  // defaulting to it would publish outside every project by accident.
  const [project, setProject] = useState<string | undefined>(initialGroup);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const chosen = fixedGroup ?? project;
  const where = chosen === undefined ? null : chosen === NO_PROJECT ? null : chosen;
  const whereName = where ? groups.find((g) => g.id === where)?.name ?? where : null;
  const canPost = Boolean(signer && relay && title.trim() && chosen !== undefined);

  const submit = useCallback(async () => {
    if (!signer || !relay || chosen === undefined) return;
    setBusy(true);
    setErr(null);
    try {
      await createPublicThread(signer, relay, { title, body, groupId: where ?? undefined });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not post the thread.');
    } finally {
      setBusy(false);
    }
  }, [signer, relay, chosen, title, body, where, onDone]);

  return (
    <div className="space-y-2 rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-4">
      {!fixedGroup && (
        <label className="block">
          <span className="text-xs text-cloistr-light/60">Project</span>
          <select
            value={project ?? ''}
            onChange={(e) => setProject(e.target.value || undefined)}
            className="mt-1 w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
          >
            <option value="" disabled>
              Choose…
            </option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value={NO_PROJECT}>No project</option>
          </select>
        </label>
      )}

      <input
        type="text"
        value={title}
        placeholder="Title"
        aria-label="Title"
        onChange={(e) => setTitle(e.target.value)}
        className="w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
      />
      <textarea
        rows={4}
        value={body}
        placeholder="What do you want to discuss?"
        aria-label="Opening post"
        onChange={(e) => setBody(e.target.value)}
        className="w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
      />

      {chosen !== undefined && (
        <p className="text-xs text-cloistr-light/60">
          Public:{' '}
          {whereName
            ? `members of ${whereName} can read it, and anyone the relay serves it to.`
            : 'anyone can read it.'}{' '}
          This cannot be changed later.
        </p>
      )}
      {!signer && <p className="text-xs text-cloistr-light/50">Sign in to post.</p>}
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
