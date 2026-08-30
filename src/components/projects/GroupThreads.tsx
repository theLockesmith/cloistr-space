/**
 * @fileoverview Threads view for a project.
 *
 * Sits beside GroupChat in the same workspace. Chat is kind:9 and stays exactly
 * as it was; threads are kind:1111 and are a separate construct over the same
 * group, so no existing message is reinterpreted or rewritten.
 */

import { useState, useCallback, useMemo } from 'react';
import { useThreads } from '@/services/threads';
import type { Thread, ThreadNode } from '@/services/threads';

interface GroupThreadsProps {
  groupId: string;
}

export function GroupThreads({ groupId }: GroupThreadsProps) {
  const { threads, isLoading, error, createThread, reply } = useThreads(groupId);

  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const submitThread = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await createThread(subject, body);
      setSubject('');
      setBody('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not post the thread');
    } finally {
      setBusy(false);
    }
  }, [createThread, subject, body]);

  const openThread = threads.find((t) => t.root.id === openThreadId) ?? null;

  if (openThread) {
    return (
      <ThreadDetail
        thread={openThread}
        onBack={() => setOpenThreadId(null)}
        onReply={reply}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-cloistr-light/10 p-4">
        <h3 className="text-sm font-medium text-cloistr-light">Threads</h3>
        <button
          onClick={() => setComposing((c) => !c)}
          className="rounded bg-cloistr-primary px-3 py-1.5 text-xs text-cloistr-dark"
        >
          {composing ? 'Cancel' : 'New thread'}
        </button>
      </div>

      {composing && (
        <div className="space-y-2 border-b border-cloistr-light/10 p-4">
          <input
            type="text"
            value={subject}
            placeholder="Subject"
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
          />
          <textarea
            rows={4}
            value={body}
            placeholder="What do you want to discuss?"
            onChange={(e) => setBody(e.target.value)}
            className="w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
          />
          <button
            onClick={() => void submitThread()}
            disabled={busy || (!subject.trim() && !body.trim())}
            className="rounded bg-cloistr-primary px-4 py-2 text-sm text-cloistr-dark disabled:opacity-50"
          >
            {busy ? 'Posting…' : 'Post thread'}
          </button>
        </div>
      )}

      {actionError && (
        <div className="m-4 rounded border border-cloistr-error/40 bg-cloistr-error/10 p-3 text-sm text-cloistr-light/80">
          {actionError}
        </div>
      )}

      {error && (
        <div className="m-4 rounded border border-cloistr-error/40 bg-cloistr-error/10 p-3 text-sm text-cloistr-light/80">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {isLoading && <p className="p-4 text-sm text-cloistr-light/50">Loading threads…</p>}

        {!isLoading && threads.length === 0 && !error && (
          <div className="p-8 text-center">
            <p className="text-sm text-cloistr-light">No threads yet</p>
            <p className="mt-1 text-xs text-cloistr-light/50">
              Threads are for discussions worth keeping separate from the chat.
            </p>
          </div>
        )}

        <ul className="divide-y divide-cloistr-light/5">
          {threads.map((thread) => (
            <li key={thread.root.id}>
              <button
                onClick={() => setOpenThreadId(thread.root.id)}
                className="w-full px-4 py-3 text-left hover:bg-cloistr-light/5"
              >
                <div className="text-sm text-cloistr-light">
                  {thread.root.subject || thread.root.content.slice(0, 80) || 'Untitled thread'}
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
    </div>
  );
}

function ThreadDetail({
  thread,
  onBack,
  onReply,
}: {
  thread: Thread;
  onBack: () => void;
  onReply: ReturnType<typeof useThreads>['reply'];
}) {
  const [replyTo, setReplyTo] = useState<{ id: string; pubkey: string } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Memoised: a fresh object literal here would be a new reference on every
  // render, invalidating the submit callback below each time.
  const target = useMemo(
    () => replyTo ?? { id: thread.root.id, pubkey: thread.root.pubkey },
    [replyTo, thread.root.id, thread.root.pubkey]
  );

  const submit = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      await onReply(
        {
          rootId: thread.root.id,
          rootPubkey: thread.root.pubkey,
          parentId: target.id,
          parentPubkey: target.pubkey,
        },
        text
      );
      setText('');
      setReplyTo(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not post the reply');
    } finally {
      setBusy(false);
    }
  }, [onReply, thread.root, target, text]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-cloistr-light/10 p-4">
        <button onClick={onBack} className="text-xs text-cloistr-light/60 hover:text-cloistr-light">
          ← Back
        </button>
        <h3 className="truncate text-sm font-medium text-cloistr-light">
          {thread.root.subject || 'Thread'}
        </h3>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-4">
        <Comment pubkey={thread.root.pubkey} content={thread.root.content} createdAt={thread.root.createdAt} />

        {thread.replies.map((node) => (
          <ReplyTree key={node.id} node={node} onSelect={(n) => setReplyTo({ id: n.id, pubkey: n.pubkey })} />
        ))}
      </div>

      <div className="border-t border-cloistr-light/10 p-4">
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 text-xs text-cloistr-light/60">
            <span>Replying to {replyTo.pubkey.slice(0, 8)}…</span>
            <button onClick={() => setReplyTo(null)} className="text-cloistr-light/40 hover:text-cloistr-light">
              clear
            </button>
          </div>
        )}
        {err && <div className="mb-2 text-xs text-cloistr-error">{err}</div>}
        <div className="flex gap-2">
          <input
            type="text"
            value={text}
            placeholder="Reply…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && text.trim() && void submit()}
            className="flex-1 rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
          />
          <button
            onClick={() => void submit()}
            disabled={busy || !text.trim()}
            className="rounded bg-cloistr-primary px-4 text-sm text-cloistr-dark disabled:opacity-50"
          >
            {busy ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReplyTree({ node, onSelect }: { node: ThreadNode; onSelect: (n: ThreadNode) => void }) {
  return (
    <div
      // Indent by depth, but stop compounding past a few levels so a deep
      // thread does not squeeze its own content into a column on mobile.
      style={{ marginLeft: `${Math.min(node.depth, 4) * 16}px` }}
    >
      <Comment
        pubkey={node.pubkey}
        content={node.content}
        createdAt={node.createdAt}
        onReply={() => onSelect(node)}
      />
      {node.replies.map((child) => (
        <ReplyTree key={child.id} node={child} onSelect={onSelect} />
      ))}
    </div>
  );
}

function Comment({
  pubkey,
  content,
  createdAt,
  onReply,
}: {
  pubkey: string;
  content: string;
  createdAt: number;
  onReply?: () => void;
}) {
  return (
    <div className="mt-2 rounded border border-cloistr-light/10 bg-cloistr-light/5 p-3">
      <div className="flex items-center justify-between text-xs text-cloistr-light/50">
        <span>{pubkey.slice(0, 8)}…</span>
        <span>{new Date(createdAt * 1000).toLocaleString()}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-cloistr-light">{content}</p>
      {onReply && (
        <button
          onClick={onReply}
          className="mt-1 text-xs text-cloistr-light/50 hover:text-cloistr-light"
        >
          Reply
        </button>
      )}
    </div>
  );
}
