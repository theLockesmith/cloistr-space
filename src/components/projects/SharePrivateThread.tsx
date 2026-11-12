/**
 * @fileoverview Hand a private thread's key to a member of this project.
 *
 * Shown to project admins only, and only for threads whose key they hold.
 * Admin is not a permission check here: a member's Space looks for hand-offs
 * only from the admins of projects they belong to (useAllThreads), so a key
 * sent by anyone else is never even fetched.
 */

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useThreadKeyStore } from '@/services/threads/useThreadKeyStore';
import { useThreadKeyGrant } from '@/services/threads/useThreadKeyGrant';
import { RESEND_WINDOWS } from '@/services/threads/handoffGrants';
import type { GroupMember } from '@/services/groups/useGroupMembers';

interface Props {
  members: GroupMember[];
  myPubkey: string;
  /** Display name per pubkey, falling back to a short key. */
  nameOf: (pubkey: string) => string;
}

export function SharePrivateThread({ members, myPubkey, nameOf }: Props) {
  const keyStore = useThreadKeyStore();
  const { grantKey, canGrant } = useThreadKeyGrant();
  const names = useSyncExternalStore(
    (cb) => keyStore.onNamesChanged(cb),
    () => keyStore.names(),
  );
  const threads = useMemo(
    () => [...names].filter(([threadPk]) => keyStore.has(threadPk)).sort((a, b) => a[1].localeCompare(b[1])),
    [names, keyStore],
  );
  const others = useMemo(() => members.filter((m) => m.pubkey !== myPubkey), [members, myPubkey]);

  const [thread, setThread] = useState('');
  const [member, setMember] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (threads.length === 0 || others.length === 0) return null;

  if (!canGrant) {
    return (
      <p className="border-b border-cloistr-light/10 px-4 py-3 text-xs text-cloistr-light/60">
        Sharing a private thread needs sign-in through the Cloistr signer. A browser extension cannot work out where to
        leave the key.
      </p>
    );
  }

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      await grantKey(thread, member);
      setResult({
        ok: true,
        text: `Sent. ${nameOf(member)} gets the key the next time they open Threads. While you have Space open it is sent again once a day for ${RESEND_WINDOWS} days, in case they are away.`,
      });
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'The key was not sent.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2 border-b border-cloistr-light/10 px-4 py-3">
      <h4 className="text-sm text-cloistr-light">Share a private thread</h4>
      <label className="block text-xs text-cloistr-light/60">
        Thread
        <select
          value={thread}
          onChange={(e) => setThread(e.target.value)}
          className="mt-1 w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
        >
          <option value="">Choose a thread</option>
          {threads.map(([pk, name]) => (
            <option key={pk} value={pk}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-cloistr-light/60">
        Member
        <select
          value={member}
          onChange={(e) => setMember(e.target.value)}
          className="mt-1 w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
        >
          <option value="">Choose a member</option>
          {others.map((m) => (
            <option key={m.pubkey} value={m.pubkey}>
              {nameOf(m.pubkey)}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-cloistr-light/60">
        They will be able to read everything in the thread, including earlier messages still on the relays.
      </p>
      <button
        onClick={() => void send()}
        disabled={sending || !thread || !member}
        className="rounded bg-cloistr-primary px-3 py-1.5 text-sm text-cloistr-dark disabled:opacity-50"
      >
        {sending ? 'Sending…' : 'Send key'}
      </button>
      {result && (
        <p role={result.ok ? 'status' : 'alert'} className={`text-xs ${result.ok ? 'text-cloistr-light/70' : 'text-cloistr-error'}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
