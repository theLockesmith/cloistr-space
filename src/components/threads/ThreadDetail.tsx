/**
 * @fileoverview One opened thread, public or private (threads.md 3.3, 6).
 *
 * Public: signed kind 11 / 1111 events, so the author shown is the signer.
 * Replies nest NIP-22 style; the owner can archive, after which the thread is
 * read-only and replies dated after the label are hidden and counted.
 *
 * Private: the sealed messages whose key the user holds. Nothing signs their
 * author, so every sender is an unverified key (threads.md 8, P0 stopgap),
 * and the envelope's `from` is never promoted to a name. v2 messages nest by
 * the parent pointer sealed inside them (sealedNesting.ts); v1 ones cannot
 * point anywhere and sit at the top level.
 */

import { useState, useCallback, type ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useHeadlessAdapters } from '@/services/nostr';
import {
  replyToPublicThread,
  archivePublicThread,
  useThreadKeyStore,
  useBucketWriter,
  type PublicThreadItem,
  type StandaloneThread,
} from '@/services/threads';
import { nestMessages, type MessageNode } from '@/services/threads/sealedNesting';
import { UnverifiedSender, shortNpub } from './sealedParts';

type Node = PublicThreadItem['thread']['replies'][number];

export function PublicThreadDetail({ item, onBack }: { item: PublicThreadItem; onBack: () => void }) {
  const { thread, groupId, rootKind } = item;
  const { root } = thread;
  const { pubkey } = useAuthStore();
  const { signer, relay } = useHeadlessAdapters();
  const archived = thread.status === 'archived';
  const isOwner = Boolean(pubkey) && pubkey === root.pubkey;

  const [replyTo, setReplyTo] = useState<{ id: string; pubkey: string } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const submit = useCallback(async () => {
    if (!signer || !relay || !text.trim()) return;
    const parent = replyTo ?? { id: root.id, pubkey: root.pubkey };
    setBusy(true);
    setErr(null);
    try {
      await replyToPublicThread(
        signer,
        relay,
        {
          rootId: root.id,
          rootPubkey: root.pubkey,
          rootKind,
          parentId: parent.id,
          parentPubkey: parent.pubkey,
          groupId: groupId ?? undefined,
        },
        text,
      );
      setText('');
      setReplyTo(null);
    } catch (e) {
      // The text stays: a failed send must not cost the user what they wrote.
      setErr(e instanceof Error ? e.message : 'Could not post the reply');
    } finally {
      setBusy(false);
    }
  }, [signer, relay, text, replyTo, root.id, root.pubkey, rootKind, groupId]);

  const archive = useCallback(async () => {
    if (!signer || !relay) return;
    setBusy(true);
    setErr(null);
    try {
      await archivePublicThread(signer, relay, root);
      setConfirmArchive(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not archive the thread');
    } finally {
      setBusy(false);
    }
  }, [signer, relay, root]);

  return (
    <div className="space-y-4">
      <DetailHeader onBack={onBack} title={root.subject || 'Untitled thread'}>
        <span className="shrink-0 rounded bg-cloistr-light/10 px-1.5 py-0.5 text-xs text-cloistr-light/70">Public</span>
        {archived && (
          <span className="shrink-0 rounded bg-cloistr-warning/15 px-1.5 py-0.5 text-xs text-cloistr-warning">Archived</span>
        )}
      </DetailHeader>

      {isOwner && !archived && !confirmArchive && (
        <button onClick={() => setConfirmArchive(true)} className="text-xs text-cloistr-light/60 hover:text-cloistr-light">
          Archive thread
        </button>
      )}
      {confirmArchive && (
        <div
          role="alertdialog"
          aria-label="Archive this thread?"
          className="rounded border border-cloistr-warning/40 bg-cloistr-warning/10 p-3 text-sm text-cloistr-light"
        >
          <p className="font-medium">Archive this thread?</p>
          <p className="mt-1 text-xs text-cloistr-light/70">
            It becomes read-only and leaves the active list. It stays searchable, and it cannot be deleted.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void archive()}
              disabled={busy || !signer || !relay}
              className="rounded bg-cloistr-primary px-3 py-1 text-xs text-cloistr-dark disabled:opacity-50"
            >
              {busy ? 'Archiving…' : 'Archive'}
            </button>
            <button
              onClick={() => setConfirmArchive(false)}
              className="rounded px-3 py-1 text-xs text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Message author={shortNpub(root.pubkey)} createdAt={root.createdAt} text={root.content} />
        {thread.replies.map((node) => (
          <ReplyTree
            key={node.id}
            node={node}
            onSelect={archived ? undefined : (n) => setReplyTo({ id: n.id, pubkey: n.pubkey })}
          />
        ))}
      </div>

      {thread.hiddenLaterReplies > 0 && (
        <p className="text-xs text-cloistr-light/50">
          {thread.hiddenLaterReplies} later {thread.hiddenLaterReplies === 1 ? 'reply' : 'replies'} hidden: posted after
          the thread was archived.
        </p>
      )}

      {err && <p className="text-xs text-cloistr-error">{err}</p>}

      {archived ? (
        <p className="text-xs text-cloistr-light/50">This thread is archived and read-only.</p>
      ) : (
        <ReplyBox
          value={text}
          onChange={setText}
          onSend={() => void submit()}
          busy={busy}
          disabledReason={!signer || !relay ? 'Sign in to reply.' : null}
          context={
            replyTo && (
              <>
                Replying to {shortNpub(replyTo.pubkey)}{' '}
                <button onClick={() => setReplyTo(null)} className="text-cloistr-light/40 hover:text-cloistr-light">
                  clear
                </button>
              </>
            )
          }
          placeholder="Reply…"
        />
      )}
    </div>
  );
}

export function PrivateThreadDetail({ thread, onBack }: { thread: StandaloneThread; onBack: () => void }) {
  const { pubkey } = useAuthStore();
  const keyStore = useThreadKeyStore();
  const { sendMessage, canPublish } = useBucketWriter();
  const threadPk = thread.threadKey.slice('sealed:'.length);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = useCallback(async () => {
    const secret = keyStore.exportHex(threadPk);
    if (!pubkey || !secret || !text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await sendMessage(text.trim(), pubkey, secret);
      setText('');
    } catch (e) {
      // The text stays, and the relay's own reason is shown.
      setErr(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setBusy(false);
    }
  }, [keyStore, threadPk, pubkey, text, sendMessage]);

  return (
    <div className="space-y-4">
      <DetailHeader onBack={onBack} title={thread.title}>
        <span className="shrink-0 rounded bg-cloistr-light/10 px-1.5 py-0.5 text-xs text-cloistr-light/70">🔒 Private</span>
      </DetailHeader>

      <ol className="space-y-2">
        {nestMessages(thread.messages).map((node) => (
          <li key={node.id}>
            <SealedReplyTree node={node} />
          </li>
        ))}
      </ol>

      {err && <p className="text-xs text-cloistr-error">{err}</p>}

      <ReplyBox
        value={text}
        onChange={setText}
        onSend={() => void send()}
        busy={busy}
        disabledReason={
          !pubkey ? 'Sign in to reply.' : !canPublish ? 'Not connected to a relay yet, so this cannot be sent.' : null
        }
        placeholder="Sealed reply…"
      />
    </div>
  );
}

function DetailHeader({ onBack, title, children }: { onBack: () => void; title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={onBack} className="shrink-0 text-xs text-cloistr-light/60 hover:text-cloistr-light">
        ← Back
      </button>
      <h2 className="min-w-0 truncate text-base font-medium text-cloistr-light">{title}</h2>
      {children}
    </div>
  );
}

function ReplyTree({ node, onSelect }: { node: Node; onSelect?: (n: Node) => void }) {
  return (
    // Indent by depth, capped so a deep thread keeps a readable column on mobile.
    <div style={{ marginLeft: `${Math.min(node.depth, 4) * 16}px` }} className="space-y-2">
      <Message
        author={shortNpub(node.pubkey)}
        createdAt={node.createdAt}
        text={node.content}
        onReply={onSelect && (() => onSelect(node))}
      />
      {node.replies.map((child) => (
        <ReplyTree key={child.id} node={child} onSelect={onSelect} />
      ))}
    </div>
  );
}

function SealedReplyTree({ node }: { node: MessageNode }) {
  return (
    // Same indent as the public tree: capped so a deep thread stays readable on mobile.
    <div style={{ marginLeft: `${Math.min(node.depth, 4) * 16}px` }} className="space-y-2">
      <Message
        author={<UnverifiedSender pubkeyHex={node.pubkey} />}
        createdAt={node.createdAt}
        approx={node.approxTime === true}
        text={node.text}
      />
      {node.replies.map((child) => (
        <SealedReplyTree key={child.id} node={child} />
      ))}
    </div>
  );
}

function Message({
  author,
  createdAt,
  approx = false,
  text,
  onReply,
}: {
  author: ReactNode;
  createdAt: number;
  approx?: boolean;
  text: string;
  onReply?: () => void;
}) {
  return (
    <div className="rounded border border-cloistr-light/10 bg-cloistr-light/5 p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-cloistr-light/50">
        <span className="font-mono">{author}</span>
        <SentAt at={createdAt} approx={approx} />
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-cloistr-light">{text}</p>
      {onReply && (
        <button onClick={onReply} className="mt-1 text-xs text-cloistr-light/50 hover:text-cloistr-light">
          Reply
        </button>
      )}
    </div>
  );
}

/**
 * An approximate time is a wrap's randomised one, up to a day early, so a
 * clock time would be precise-looking and wrong: show the day only.
 */
export function SentAt({ at, approx }: { at: number; approx: boolean }) {
  const d = new Date(at * 1000);
  if (!approx) return <>{d.toLocaleString()}</>;
  return <span title="Exact time not recorded by the sender">~{d.toLocaleDateString()}</span>;
}

/** A reply box that says why it cannot send rather than vanishing. */
function ReplyBox({
  value,
  onChange,
  onSend,
  busy,
  disabledReason,
  context,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  disabledReason: string | null;
  context?: ReactNode;
  placeholder: string;
}) {
  return (
    <div className="space-y-2 border-t border-cloistr-light/10 pt-3">
      {context && <div className="text-xs text-cloistr-light/60">{context}</div>}
      {disabledReason && <p className="text-xs text-cloistr-light/50">{disabledReason}</p>}
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={Boolean(disabledReason)}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value.trim() && !busy && onSend()}
          className="min-w-0 flex-1 rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light disabled:opacity-50"
        />
        <button
          onClick={onSend}
          disabled={busy || !value.trim() || Boolean(disabledReason)}
          className="rounded bg-cloistr-primary px-4 text-sm text-cloistr-dark disabled:opacity-50"
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
