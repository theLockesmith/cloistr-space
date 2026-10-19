/**
 * @fileoverview Threads across every group the user belongs to.
 *
 * The in-project tab is the place you read a thread; this is the place you find
 * one. Threads were previously reachable only inside /projects/:groupId, so a
 * user with no project selected saw no trace of the feature -- which is how it
 * read as never shipped.
 *
 * ONE filter, not one per group. `#h` takes an array, so membership in twenty
 * groups is `{kinds:[1111], '#h':[...twenty ids]}` rather than twenty
 * subscriptions. Worth stating because the obvious implementation is a loop,
 * and under the outbox model every extra subscription fans out across each
 * author's relays -- so a loop multiplies connections rather than adding them.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
import { useNdk, subscribeStream, type NDKEvent } from '@/services/nostr';
import { useGroups } from '@/services/groups';
import {
  THREAD_KIND,
  assembleThreads,
  type Thread,
  type ThreadComment,
} from './threadEvents';
import { decryptThreadContent, looksLikeNip44 } from './threadKeyStore';
import { useThreadKeyStore } from './useThreadKeyStore';
import { useAuthStore } from '@/stores/authStore';
import { config } from '@/config/environment';
import {
  acceptStandalone,
  acceptWrapped,
  groupStandalone,
  threadIdsFromHandoffs,
  type StandaloneMessage,
  type StandaloneThread,
} from './standaloneThreads';
import { useBucketReader, type BucketReaderReturn } from './useBucketReader';

/** A thread plus the group it belongs to, for a listing that spans groups. */
export interface ThreadWithGroup {
  thread: Thread;
  groupId: string;
  groupName: string;
}

export interface UseAllThreadsReturn {
  threads: ThreadWithGroup[];
  /** Groups the user is in, for the create-thread picker. */
  groups: { id: string; name: string }[];
  /** Admin pubkeys across all the user's groups, deduplicated. */
  allAdminPubkeys: string[];
  /**
   * Threads outside the user's projects: fleet-sealed threads whose key the
   * user holds, and the user's own threads with no project. See
   * standaloneThreads.ts for exactly what is admitted.
   */
  standalone: StandaloneThread[];
  /**
   * The bucket reader behind the wrap-mode messages in `standalone`. The
   * Threads page hands this same reader to its Sealed box, so the page runs
   * one bucket subscription, not two.
   */
  sealedReader: BucketReaderReturn;
  isLoading: boolean;
  error: string | null;
}

/**
 * Parse a kind:1111 without knowing its group in advance.
 *
 * parseThreadEvent takes a groupId and rejects anything else, which is right
 * for a single-group view. Here the group is what we are reading OUT of the
 * event, so the h tag is the answer rather than the check -- but it is still
 * checked against known membership by the caller, so a thread from a group the
 * user is not in cannot appear.
 *
 * When a ThreadKeyStore is provided and the content looks like NIP-44
 * ciphertext, attempts decryption using the thread pubkey from the event's
 * `thread` tag. Falls through to raw content when no key is held or
 * decryption fails.
 */
function parseAnyGroupThread(
  event: NDKEvent,
  keyStore?: import('./threadKeyStore').ThreadKeyStore,
): ThreadComment | null {
  const hTag = event.tags.find((t) => t[0] === 'h');
  if (!hTag?.[1]) return null;

  let content = event.content;
  let sealed = false;

  if (keyStore && looksLikeNip44(content)) {
    sealed = true;
    const threadPubkey = event.tags.find((t: string[]) => t[0] === 'thread')?.[1];
    if (threadPubkey) {
      const sk = keyStore.get(threadPubkey);
      if (sk) {
        const decrypted = decryptThreadContent(content, sk, event.pubkey);
        if (decrypted !== null) {
          content = decrypted;
        }
      }
    }
  }

  return {
    id: event.id,
    pubkey: event.pubkey,
    groupId: hTag[1],
    content,
    createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
    rootId: event.tags.find((t) => t[0] === 'E')?.[1],
    parentId: event.tags.find((t) => t[0] === 'e')?.[1],
    subject: event.tags.find((t) => t[0] === 'subject')?.[1],
    sealed: sealed || undefined,
  };
}

export function useAllThreads(): UseAllThreadsReturn {
  const { subscribe, isConnected } = useNdk();
  const { groups: memberships, isLoading: groupsLoading } = useGroups();
  const keyStore = useThreadKeyStore();

  const [comments, setComments] = useState<ThreadComment[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const commentsRef = useRef<Map<string, ThreadComment>>(new Map());
  const subsRef = useRef<NDKSubscription[]>([]);

  const me = useAuthStore((s) => s.pubkey) ?? null;
  // Keyed by the query that produced them, so a new query (another signed-in
  // key) starts from nothing without a state reset inside an effect.
  const [standaloneState, setStandaloneState] = useState<{ query: string; messages: StandaloneMessage[] }>({
    query: '',
    messages: [],
  });

  const groups = useMemo(
    () => memberships.map((m) => ({ id: m.group.identifier, name: m.group.name })),
    [memberships]
  );

  const allAdminPubkeys = useMemo(
    () => Array.from(new Set(memberships.flatMap((m) => m.adminPubkeys))),
    [memberships],
  );

  // Content identity, not array identity: useGroups hands back a new array on
  // every engagement-style update, and re-subscribing on each one would be
  // constant churn.
  const groupIdsKey = groups.map((g) => g.id).sort().join(',');

  useEffect(() => {
    if (!subscribe || !isConnected || groups.length === 0) return;

    const filter: NDKFilter = {
      kinds: [THREAD_KIND as number],
      '#h': groups.map((g) => g.id),
    };

    // Thread roots are HISTORICAL -- written once and read forever -- so the
    // opening burst is the whole answer and handlers must be registered at
    // subscribe time. Left open so a thread started while this view is on
    // screen appears without a reload.
    const sub = subscribeStream(subscribe, [filter], {
      onEvent: (event: NDKEvent) => {
        const parsed = parseAnyGroupThread(event, keyStore);
        if (!parsed) return;

        commentsRef.current.set(parsed.id, parsed);
        setComments(Array.from(commentsRef.current.values()));
        setIsFetching(false);
      },
      onEose: () => setIsFetching(false),
    });

    // A subscription that throws on creation would otherwise leave the view
    // spinning forever with nothing to explain it.
    if (!sub) {
      setError('Could not open the threads subscription.');
      setIsFetching(false);
      return;
    }

    subsRef.current.push(sub);
    // groupIdsKey is the content-identity of `groups`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, isConnected, groupIdsKey]);

  // Standalone threads. The kit signs each message with the sending ROLE's own
  // key (there are dozens), so asking by author cannot find them. What a relay
  // CAN answer is the single-letter `d` tag, which carries the thread id, and
  // the id comes from the sealed hand-off. Wrap-mode threads (the live kit's
  // mode) are kind 1059 under one-time keys; those come from the bucket
  // reader, the same one the Sealed box uses. The user's own unsealed threads
  // are still asked for by author. acceptStandalone / acceptWrapped keep only
  // what the user may see; a message for a key they do not hold is dropped
  // before it reaches state.
  const granters = useMemo(
    () => Array.from(new Set([...config.threadGranters, ...allAdminPubkeys])),
    [allAdminPubkeys],
  );
  const sealedReader = useBucketReader(null, granters);
  const threadIds = useMemo(() => threadIdsFromHandoffs(sealedReader.handoffs), [sealedReader.handoffs]);
  const threadIdsKey = [...new Set(threadIds.values())].sort().join(',');

  const membershipRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    membershipRef.current = new Set(groupIdsKey ? groupIdsKey.split(',') : []);
  }, [groupIdsKey]);
  const meKey = me ?? '';

  useEffect(() => {
    if (!subscribe || !isConnected) return;
    const filters: NDKFilter[] = [];
    if (meKey) filters.push({ kinds: [THREAD_KIND as number], authors: [meKey] });
    if (threadIdsKey) filters.push({ kinds: [THREAD_KIND as number], '#d': threadIdsKey.split(',') });
    if (filters.length === 0) return;
    const sub = subscribeStream(subscribe, filters, {
      onEvent: (event: NDKEvent) => {
        const msg = acceptStandalone(event, { keyStore, me, memberProjects: membershipRef.current });
        if (!msg) return;
        // Merge into what this user already holds: a new thread id re-subscribes,
        // and that must add to the list, never restart it.
        setStandaloneState((prev) => {
          const kept = prev.query === meKey ? prev.messages.filter((m) => m.id !== msg.id) : [];
          return { query: meKey, messages: [...kept, msg] };
        });
      },
    });
    if (!sub) return;
    return () => sub.stop();
    // keyStore and me are read through meKey/closure; a key held later arrives
    // with its hand-off, which changes threadIdsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, isConnected, meKey, threadIdsKey]);

  const standalone = useMemo(() => {
    const own = standaloneState.query === meKey ? standaloneState.messages : [];
    const wrapped = sealedReader.messages
      .map((m) => acceptWrapped(m, { keyStore, threadIds }))
      .filter((m): m is StandaloneMessage => m !== null);
    // Re-filter on membership: a project joined later moves its threads to the project path.
    const member = new Set(groupIdsKey ? groupIdsKey.split(',') : []);
    const named = [...own, ...wrapped].map((m) =>
      m.sealed && threadIds.has(m.threadKey.slice('sealed:'.length))
        ? { ...m, title: threadIds.get(m.threadKey.slice('sealed:'.length))! }
        : m
    );
    return groupStandalone(named.filter((m) => !m.projectId || !member.has(m.projectId)));
  }, [standaloneState, meKey, sealedReader.messages, keyStore, threadIds, groupIdsKey]);

  // Stopped on unmount and on connection change only -- NOT on groupIdsKey.
  // The deps above describe which groups to ASK ABOUT; tearing the subscription
  // down when that set settles would cancel the query before its answer
  // arrives, which is exactly how author profiles failed.
  useEffect(() => {
    return () => {
      for (const sub of subsRef.current) {
        sub.stop();
      }
      subsRef.current = [];
    };
  }, [subscribe, isConnected]);

  const threads = useMemo(() => {
    const byGroup = new Map<string, ThreadComment[]>();
    for (const comment of comments) {
      const bucket = byGroup.get(comment.groupId);
      if (bucket) bucket.push(comment);
      else byGroup.set(comment.groupId, [comment]);
    }

    const out: ThreadWithGroup[] = [];
    for (const group of groups) {
      const groupComments = byGroup.get(group.id);
      if (!groupComments) continue;
      // Assemble per group: a reply can only belong to a root in its own group,
      // and pooling them would let an id collision cross a membership boundary.
      for (const thread of assembleThreads(groupComments)) {
        out.push({ thread, groupId: group.id, groupName: group.name });
      }
    }

    // Newest activity first across all groups, matching the in-project view.
    return out.sort((a, b) => b.thread.lastActivity - a.thread.lastActivity);
  }, [comments, groups]);

  return {
    threads,
    groups,
    allAdminPubkeys,
    standalone,
    sealedReader,
    // Still loading while groups resolve: with no groups yet there is nothing
    // to subscribe to, and reporting "no threads" then would be the same lie as
    // every other empty-versus-unloaded confusion this app has had.
    isLoading: groupsLoading || (groups.length > 0 && isFetching),
    error,
  };
}
