/**
 * Sealed thread messages view: reads from the bucketed blind mailbox.
 *
 * Subscribes to K=16 buckets, trial-decrypts incoming kind 1059 wraps
 * against held thread keys, and displays the plaintext. Messages whose
 * key the user does not hold are invisible — they never leave the
 * relay's encrypted form.
 */

import { useState, useCallback, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import {
  useThreadKeyStore,
  useThreadKeyLoader,
  useBucketReader,
  useBucketWriter,
  type UnwrappedMessage,
} from '@/services/threads';
import { useAuthorProfiles } from '@/services/profile';
import { useGroupMembers } from '@/services/groups/useGroupMembers';
import { config } from '@/config/environment';
import { parseFleetEnvelope } from '@/services/threads/fleetEnvelope';

interface SealedMessagesProps {
  groupId?: string;
  additionalGranters?: string[];
}

export function SealedMessages({ groupId, additionalGranters }: SealedMessagesProps) {
  const { pubkey } = useAuthStore();
  const { loaded, keyCount } = useThreadKeyLoader();
  const { members } = useGroupMembers(groupId ?? '');

  const granterPubkeys = useMemo(() => {
    const set = new Set(config.threadGranters);
    if (groupId) {
      for (const m of members) {
        if (m.isAdmin) set.add(m.pubkey);
      }
    }
    if (additionalGranters) {
      for (const pk of additionalGranters) set.add(pk);
    }
    return Array.from(set);
  }, [members, groupId, additionalGranters]);

  const { messages, handoffs, isLoading, error, refresh, debug } = useBucketReader(null, granterPubkeys);

  // Keys held NOW. The loader's keyCount is read once, from storage, when the

  // page loads; keys that arrive later by hand-off never updated it, so the

  // panel said "No thread keys held" above a message it had just decrypted and

  // hid the reply box (seen live 2026-09-28). This re-renders on every new

  // message or hand-off, which is exactly when the store changes.

  const keyStore = useThreadKeyStore();

  const heldKeys = Math.max(keyCount, keyStore.size);

  const authorPubkeys = useMemo(
    () => [...new Set(messages.map((m) => m.authorHex))],
    [messages],
  );
  const profiles = useAuthorProfiles(authorPubkeys);

  const byThread = useMemo(() => {
    const map = new Map<string, UnwrappedMessage[]>();
    for (const msg of messages) {
      const list = map.get(msg.threadId) ?? [];
      list.push(msg);
      map.set(msg.threadId, list);
    }
    return map;
  }, [messages]);

  if (!pubkey) {
    return (
      <div className="p-8 text-center text-sm text-cloistr-light/60">
        Log in to read sealed messages.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-cloistr-light/10 p-4">
        <div>
          <h3 className="text-sm font-medium text-cloistr-light">Sealed Messages</h3>
          <p className="text-xs text-cloistr-light/50">
            {heldKeys} thread {heldKeys === 1 ? 'key' : 'keys'} ·{' '}
            {messages.length} {messages.length === 1 ? 'message' : 'messages'} ·{' '}
            {handoffs.length} {handoffs.length === 1 ? 'handoff' : 'handoffs'}
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-cloistr-light/30">diag</summary>
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-cloistr-dark/50 p-2 text-xs text-cloistr-light/40">
{JSON.stringify(debug, null, 2)}
            </pre>
          </details>
        </div>
        <button
          onClick={refresh}
          className="rounded px-3 py-1.5 text-xs text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="m-4 rounded border border-cloistr-error/40 bg-cloistr-error/10 p-3 text-sm text-cloistr-light/80">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {isLoading && !messages.length && (
          <p className="p-4 text-sm text-cloistr-light/50">
            {!loaded ? 'Loading thread keys…' : 'Scanning buckets…'}
          </p>
        )}

        {!isLoading && heldKeys === 0 && (
          <div className="p-8 text-center">
            <p className="text-sm text-cloistr-light">No thread keys held</p>
            <p className="mt-1 text-xs text-cloistr-light/50">
              You need to receive a thread key handoff before you can read sealed messages.
            </p>
          </div>
        )}

        {!isLoading && heldKeys > 0 && messages.length === 0 && (
          <div className="p-8 text-center">
            <p className="text-sm text-cloistr-light">No sealed messages found</p>
            <p className="mt-1 text-xs text-cloistr-light/50">
              Holding {heldKeys} {heldKeys === 1 ? 'key' : 'keys'}, scanning {16} buckets per window.
            </p>
          </div>
        )}

        {Array.from(byThread.entries()).map(([threadId, msgs]) => (
          <div key={threadId} className="border-b border-cloistr-light/5">
            <div className="bg-cloistr-light/5 px-4 py-2 text-xs text-cloistr-light/50">
              {msgs.map((m) => parseFleetEnvelope(m.plaintext)?.thread).find(Boolean) ?? `Thread ${threadId.slice(0, 12)}…`}
            </div>
            <div className="space-y-2 p-4">
              {msgs.map((msg) => {
                const profile = profiles.get(msg.authorHex);
                const envelope = parseFleetEnvelope(msg.plaintext);
                const name = envelope?.from || profile?.displayName || profile?.name || msg.authorHex.slice(0, 8) + '…';
                return (
                  <div key={msg.wrapId} className="rounded border border-cloistr-light/10 bg-cloistr-light/5 p-3">
                    <div className="flex items-center gap-2 text-xs text-cloistr-light/50">
                      <span>{name}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-cloistr-light">
                      {envelope ? envelope.body : msg.plaintext}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {heldKeys > 0 && <ComposeBar />}
    </div>
  );
}

function ComposeBar() {
  const { pubkey } = useAuthStore();
  const keyStore = useThreadKeyStore();
  const { sendMessage, canPublish } = useBucketWriter();

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const threadEntries = useMemo(
    () => Array.from(keyStore.entries()),
    [keyStore],
  );
  const [selectedThread, setSelectedThread] = useState<string>('');
  const activeThread = selectedThread || (threadEntries.length > 0 ? threadEntries[0][0] : '');

  const send = useCallback(async () => {
    if (!text.trim() || !pubkey || !activeThread || busy) return;

    const entry = threadEntries.find(([pk]) => pk === activeThread);
    if (!entry) return;

    setBusy(true);
    setErr(null);
    try {
      const [, threadSk] = entry;
      const { bytesToHex } = await import('nostr-tools/utils');
      await sendMessage(text.trim(), pubkey, bytesToHex(threadSk));
      setText('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setBusy(false);
    }
  }, [text, pubkey, activeThread, threadEntries, busy, sendMessage]);

  if (!canPublish) return null;

  return (
    <div className="border-t border-cloistr-light/10 p-4">
      {threadEntries.length > 1 && (
        <select
          value={activeThread}
          onChange={(e) => setSelectedThread(e.target.value)}
          className="mb-2 w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-1.5 text-xs text-cloistr-light"
        >
          {threadEntries.map(([pk]) => (
            <option key={pk} value={pk}>
              Thread {pk.slice(0, 12)}…
            </option>
          ))}
        </select>
      )}
      {err && <div className="mb-2 text-xs text-cloistr-error">{err}</div>}
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          placeholder="Sealed message…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && void send()}
          className="flex-1 rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !text.trim()}
          className="rounded bg-cloistr-primary px-4 text-sm text-cloistr-dark disabled:opacity-50"
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
