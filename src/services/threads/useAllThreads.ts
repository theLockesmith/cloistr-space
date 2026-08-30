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
 */
function parseAnyGroupThread(event: NDKEvent): ThreadComment | null {
  const hTag = event.tags.find((t) => t[0] === 'h');
  if (!hTag?.[1]) return null;

  return {
    id: event.id,
    pubkey: event.pubkey,
    groupId: hTag[1],
    content: event.content,
    createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
    rootId: event.tags.find((t) => t[0] === 'E')?.[1],
    parentId: event.tags.find((t) => t[0] === 'e')?.[1],
    subject: event.tags.find((t) => t[0] === 'subject')?.[1],
  };
}

export function useAllThreads(): UseAllThreadsReturn {
  const { subscribe, isConnected } = useNdk();
  const { groups: memberships, isLoading: groupsLoading } = useGroups();

  const [comments, setComments] = useState<ThreadComment[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const commentsRef = useRef<Map<string, ThreadComment>>(new Map());
  const subsRef = useRef<NDKSubscription[]>([]);

  const groups = useMemo(
    () => memberships.map((m) => ({ id: m.group.identifier, name: m.group.name })),
    [memberships]
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
        const parsed = parseAnyGroupThread(event);
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
    // Still loading while groups resolve: with no groups yet there is nothing
    // to subscribe to, and reporting "no threads" then would be the same lie as
    // every other empty-versus-unloaded confusion this app has had.
    isLoading: groupsLoading || (groups.length > 0 && isFetching),
    error,
  };
}
