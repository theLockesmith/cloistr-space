/**
 * @fileoverview Every thread this user can see, public and private, in one list
 * (threads.md 6).
 *
 * Public threads are kind 11 roots (or legacy kind 1111 roots) with kind 1111
 * replies and the owner's kind 1985 status labels; publicThreadList.ts decides
 * what each event means. Private threads are the sealed ones: the kit's wrap
 * mode through the bucket reader, and its legacy kind 1111 shape by `#d`;
 * standaloneThreads.ts decides what may be shown.
 *
 * ONE filter per question, not one per group. `#h` takes an array, so
 * membership in twenty groups is one filter rather than twenty subscriptions.
 * Worth stating because the obvious implementation is a loop, and under the
 * outbox model every extra subscription fans out across each author's relays.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { NDKFilter } from '@nostr-dev-kit/ndk';
import {
  THREAD_ROOT_KIND,
  STATUS_LABEL_KIND,
  STATUS_NAMESPACE,
  type PublicEvent,
  type PublicThreadComment,
} from '@cloistr/threads';
import { useNdk, subscribeStream, type NDKEvent } from '@/services/nostr';
import { useGroups } from '@/services/groups';
import { THREAD_KIND } from './threadEvents';
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
import { admitPublicEvent, foldPublicThreads, type PublicThreadItem } from './publicThreadList';

export interface UseAllThreadsReturn {
  /** Public threads, status applied, newest activity first. */
  publicThreads: PublicThreadItem[];
  /**
   * Sealed threads whose key the user holds. See standaloneThreads.ts for
   * exactly what is admitted.
   */
  privateThreads: StandaloneThread[];
  /** Groups the user is in, for the project filter and the new-thread picker. */
  groups: { id: string; name: string }[];
  /** Admin pubkeys across all the user's groups, deduplicated. */
  allAdminPubkeys: string[];
  /**
   * The bucket reader behind the wrap-mode messages in `privateThreads`, and
   * the key offers waiting on the user. One per page, so the page runs one
   * bucket subscription, not two.
   */
  sealedReader: BucketReaderReturn;
  isLoading: boolean;
  error: string | null;
}

function toPublicEvent(event: NDKEvent): PublicEvent {
  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind ?? 0,
    content: event.content,
    created_at: event.created_at,
    tags: event.tags,
  };
}

const sortedKey = (values: Iterable<string>) => [...new Set(values)].sort().join(',');

export function useAllThreads(): UseAllThreadsReturn {
  const { subscribe, isConnected } = useNdk();
  const { groups: memberships, isLoading: groupsLoading } = useGroups();
  const keyStore = useThreadKeyStore();
  const me = useAuthStore((s) => s.pubkey) ?? null;
  const meKey = me ?? '';

  const groups = useMemo(
    () => memberships.map((m) => ({ id: m.group.identifier, name: m.group.name })),
    [memberships],
  );
  const allAdminPubkeys = useMemo(
    () => Array.from(new Set(memberships.flatMap((m) => m.adminPubkeys))),
    [memberships],
  );

  // Content identity, not array identity: useGroups hands back a new array on
  // every engagement-style update, and re-subscribing on each one would be
  // constant churn.
  const groupIdsKey = sortedKey(groups.map((g) => g.id));

  const membershipRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    membershipRef.current = new Set(groupIdsKey ? groupIdsKey.split(',') : []);
  }, [groupIdsKey]);

  // Keyed by the signed-in key that produced them, so another key starts from
  // nothing without a state reset inside an effect.
  const [publicState, setPublicState] = useState<{
    me: string;
    comments: Map<string, PublicThreadComment>;
    labels: Map<string, PublicEvent>;
  }>({ me: '', comments: new Map(), labels: new Map() });
  const [sealedState, setSealedState] = useState<{ me: string; messages: StandaloneMessage[] }>({
    me: '',
    messages: [],
  });
  const [settled, setSettled] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sealed threads. The kit signs each message with the sending ROLE's own key
  // (there are dozens), so asking by author cannot find them. What a relay CAN
  // answer is the single-letter `d` tag, which carries the thread id, and the
  // id comes from the sealed hand-off or the name saved with the key.
  const granters = useMemo(
    () => Array.from(new Set([...config.threadGranters, ...allAdminPubkeys])),
    [allAdminPubkeys],
  );
  const sealedReader = useBucketReader(null, granters);
  // A hand-off lives on the relays for about two days; the name saved with the
  // key is what keeps an older thread findable after that. Hand-offs win on a
  // conflict because they are the newer word.
  const savedNames = useSyncExternalStore(
    (cb) => keyStore.onNamesChanged(cb),
    () => keyStore.names(),
  );
  const threadIds = useMemo(
    () => new Map([...savedNames, ...threadIdsFromHandoffs(sealedReader.handoffs)]),
    [savedNames, sealedReader.handoffs],
  );
  const threadIdsKey = sortedKey(threadIds.values());

  // What to ask about: the user's groups, the user's own threads anywhere, and
  // the sealed threads they hold a key for. Thread roots are HISTORICAL --
  // written once and read forever -- so the opening burst is the whole answer;
  // the subscription stays open so a thread started meanwhile appears.
  const scopeKey = `${groupIdsKey}|${meKey}|${threadIdsKey}`;
  useEffect(() => {
    if (!subscribe || !isConnected) return;
    const filters: NDKFilter[] = [];
    if (groupIdsKey) filters.push({ kinds: [THREAD_ROOT_KIND, THREAD_KIND], '#h': groupIdsKey.split(',') });
    if (meKey) filters.push({ kinds: [THREAD_ROOT_KIND, THREAD_KIND], authors: [meKey] });
    if (threadIdsKey) filters.push({ kinds: [THREAD_KIND], '#d': threadIdsKey.split(',') });
    if (filters.length === 0) return;

    const sub = subscribeStream(subscribe, filters, {
      onEvent: (event: NDKEvent) => {
        const raw = toPublicEvent(event);
        const sealed = acceptStandalone(raw, { keyStore });
        if (sealed) {
          // Merge into what this key already holds: a new thread id
          // re-subscribes, and that must add to the list, never restart it.
          setSealedState((prev) => {
            const kept = prev.me === meKey ? prev.messages.filter((m) => m.id !== sealed.id) : [];
            return { me: meKey, messages: [...kept, sealed] };
          });
          return;
        }
        const comment = admitPublicEvent(raw, { memberGroups: membershipRef.current, me });
        if (!comment) return;
        setPublicState((prev) => {
          const base = prev.me === meKey ? prev : { me: meKey, comments: new Map(), labels: new Map() };
          return { ...base, comments: new Map(base.comments).set(comment.id, comment) };
        });
      },
      onEose: () => setSettled(scopeKey),
    });
    // A subscription that throws on creation would otherwise leave the view
    // spinning forever with nothing to explain it.
    if (!sub) {
      setError('Could not open the threads subscription.');
      setSettled(scopeKey);
      return;
    }
    return () => sub.stop();
    // keyStore and me are read through meKey and the closure; a key held later
    // arrives with its hand-off, which changes threadIdsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, isConnected, scopeKey]);

  const comments = useMemo(
    () => (publicState.me === meKey ? [...publicState.comments.values()] : []),
    [publicState, meKey],
  );

  // Second question, once roots are known: replies to roots outside the user's
  // groups (the group filter cannot see them), and every root's status labels,
  // asked only of the root authors since nobody else's label counts.
  const roots = comments.filter((c) => !c.rootId);
  const outsideRootsKey = sortedKey(roots.filter((r) => !r.groupId || !membershipRef.current.has(r.groupId)).map((r) => r.id));
  const allRootsKey = sortedKey(roots.map((r) => r.id));
  const rootAuthorsKey = sortedKey(roots.map((r) => r.pubkey));
  useEffect(() => {
    if (!subscribe || !isConnected || !allRootsKey) return;
    const filters: NDKFilter[] = [
      {
        kinds: [STATUS_LABEL_KIND],
        '#L': [STATUS_NAMESPACE],
        '#e': allRootsKey.split(','),
        authors: rootAuthorsKey.split(','),
      },
    ];
    if (outsideRootsKey) filters.push({ kinds: [THREAD_KIND], '#E': outsideRootsKey.split(',') });

    const sub = subscribeStream(subscribe, filters, {
      onEvent: (event: NDKEvent) => {
        const raw = toPublicEvent(event);
        if (raw.kind === STATUS_LABEL_KIND) {
          setPublicState((prev) =>
            prev.me === meKey ? { ...prev, labels: new Map(prev.labels).set(raw.id, raw) } : prev,
          );
          return;
        }
        const comment = admitPublicEvent(raw, { memberGroups: membershipRef.current, me });
        if (!comment) return;
        setPublicState((prev) =>
          prev.me === meKey ? { ...prev, comments: new Map(prev.comments).set(comment.id, comment) } : prev,
        );
      },
    });
    if (!sub) return;
    return () => sub.stop();
    // me is read through meKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, isConnected, meKey, allRootsKey, rootAuthorsKey, outsideRootsKey]);

  const publicThreads = useMemo(
    () => foldPublicThreads(comments, publicState.me === meKey ? [...publicState.labels.values()] : []),
    [comments, publicState, meKey],
  );

  const privateThreads = useMemo(() => {
    const legacy = sealedState.me === meKey ? sealedState.messages : [];
    const wrapped = sealedReader.messages
      .map((m) => acceptWrapped(m, { keyStore, threadIds }))
      .filter((m): m is StandaloneMessage => m !== null);
    const named = [...legacy, ...wrapped].map((m) => {
      const name = threadIds.get(m.threadKey.slice('sealed:'.length));
      return name ? { ...m, title: name } : m;
    });
    return groupStandalone(named);
  }, [sealedState, meKey, sealedReader.messages, keyStore, threadIds]);

  // Nothing to ask about until groups resolve and someone is signed in, and
  // "no threads" then would be the same lie as every other empty-versus-
  // unloaded confusion this app has had.
  const somethingToAsk = Boolean(groupIdsKey || meKey || threadIdsKey);
  const isLoading = groupsLoading || (somethingToAsk && Boolean(isConnected) && settled !== scopeKey);

  return { publicThreads, privateThreads, groups, allAdminPubkeys, sealedReader, isLoading, error };
}
