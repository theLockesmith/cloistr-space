/**
 * @fileoverview Read and publish the signed-in user's kind:0 and kind:10002.
 *
 * All signing is client-side through the existing session signer. Backends
 * never publish events on a user's behalf -- see the Cloistr development
 * philosophy doc.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NDKEvent, NDKFilter, NDKRelaySet } from '@nostr-dev-kit/ndk';
import { useNdk } from '@/services/nostr';
import { PUBLIC_OUTBOX_INDEXERS } from '@/services/nostr/ndk';
import { useAuthStore } from '@/stores/authStore';
import {
  METADATA_KIND,
  RELAY_LIST_KIND,
  mergeProfileContent,
  parseProfileContent,
  buildRelayListTags,
  parseRelayListTags,
  type ExistingProfile,
  type ProfileFields,
  type RelayListEntry,
} from './profileEvents';

export interface UseProfileReturn {
  profile: ProfileFields;
  relays: RelayListEntry[];
  /**
   * How the relay-list read went. Gates saveRelays the way `existing` gates
   * saveProfile; null means it has not settled yet.
   */
  relayListRead: RelayListRead | null;
  /** How the existing profile read went. Gates whether saving is safe. */
  existing: ExistingProfile | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  /** Reread from relays, discarding local edits. */
  reload: () => Promise<void>;
  saveProfile: (updates: ProfileFields) => Promise<void>;
  saveRelays: (entries: RelayListEntry[]) => Promise<void>;
}

/** `found` and `absent` are safe to save over; `unreadable` is not. */
export type RelayListRead = 'found' | 'absent' | 'unreadable';

/**
 * Newest wins when relays disagree.
 *
 * Both kind:0 and kind:10002 are replaceable, so relays should converge on one
 * event -- but they lag, and a stale copy from a slow relay must not be the one
 * we merge onto, or we would resurrect fields the user already deleted.
 */
function newestOf<T extends { created_at?: number }>(events: Iterable<T>): T | null {
  let newest: T | null = null;
  for (const event of events) {
    if (!newest || (event.created_at ?? 0) > (newest.created_at ?? 0)) {
      newest = event;
    }
  }
  return newest;
}

/** How long the user's own write relays get to answer a profile read. */
export const OWN_RELAY_PROFILE_TIMEOUT_MS = 8000;

type SubscribeLike = (
  filters: NDKFilter[],
  opts: { closeOnEose: boolean; groupable: boolean; relaySet: NDKRelaySet },
  handlers: { onEvent?: (e: NDKEvent) => void; onEose?: () => void }
) => { eosesSeen?: Set<unknown>; stop: () => void };

const sameRelay = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/**
 * Ask one write relay for the user's kind:0, on its own subscription.
 *
 * One subscription per relay because NDK's onEose is per subscription and
 * fires without waiting for every relay (its own timers), and closeOnEose then
 * stops it, losing a slow relay's answer. A relay counts as answered only when
 * it is in eosesSeen.
 */
function readOneRelay(
  subscribe: SubscribeLike,
  service: { getRelaySetFor(urls: string[]): NDKRelaySet | undefined },
  url: string,
  pubkey: string,
  kind: number = METADATA_KIND,
): Promise<{ url: string; answered: boolean; events: NDKEvent[] }> {
  return new Promise((resolve) => {
    const relaySet = service.getRelaySetFor([url]);
    if (!relaySet) {
      resolve({ url, answered: false, events: [] });
      return;
    }
    const events: NDKEvent[] = [];
    let done = false;
    let sub: ReturnType<SubscribeLike> | undefined;
    const finish = (answered: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub?.stop();
      resolve({ url, answered, events });
    };
    const timer = setTimeout(() => finish(false), OWN_RELAY_PROFILE_TIMEOUT_MS);
    sub = subscribe(
      [{ kinds: [kind], authors: [pubkey], limit: 5 }],
      { closeOnEose: true, groupable: false, relaySet },
      {
        onEvent: (e) => {
          if (e.pubkey === pubkey) events.push(e);
        },
        onEose: () =>
          queueMicrotask(() =>
            finish([...((sub?.eosesSeen ?? new Set()) as Set<{ url?: string }>)].some((r) => !!r.url && sameRelay(r.url, url))),
          ),
      },
    );
  });
}

/**
 * Read kind:0 from every one of the user's write relays (sweep #6, and the
 * ruling on !228).
 *
 * Waits for all of them, each up to OWN_RELAY_PROFILE_TIMEOUT_MS, and returns
 * every profile seen plus the relays that never answered. The caller takes
 * the newest across everything, never the first to arrive: a slow relay may
 * hold the newer profile, and saving over it with older fields loses data.
 */
async function readOwnRelayProfiles(
  subscribe: SubscribeLike,
  service: { getRelaySetFor(urls: string[]): NDKRelaySet | undefined },
  urls: string[],
  pubkey: string,
): Promise<{ events: NDKEvent[]; silent: string[] }> {
  const answers = await Promise.all(urls.map((u) => readOneRelay(subscribe, service, u, pubkey)));
  return {
    events: answers.flatMap((a) => a.events),
    silent: answers.filter((a) => !a.answered).map((a) => a.url),
  };
}

/**
 * Ask the public relay-list indexers for the user's kind:10002 (review of
 * !263). Space's pool answering with nothing does not mean the user has no
 * list: it may live only on relays Space cannot reach. `answered` is false
 * when no indexer answered at all, which is not "absent" either.
 */
async function readIndexedRelayList(
  subscribe: SubscribeLike,
  service: { getRelaySetFor(urls: string[]): NDKRelaySet | undefined },
  pubkey: string,
): Promise<{ events: NDKEvent[]; answered: boolean }> {
  const answers = await Promise.all(
    PUBLIC_OUTBOX_INDEXERS.map((u) => readOneRelay(subscribe, service, u, pubkey, RELAY_LIST_KIND)),
  );
  return { events: answers.flatMap((a) => a.events), answered: answers.some((a) => a.answered) };
}

export function useProfile(): UseProfileReturn {
  const { fetchEvents, createEvent, publish, isConnected, service, subscribe } = useNdk();
  const pubkey = useAuthStore((s) => s.pubkey);

  const [profile, setProfile] = useState<ProfileFields>({});
  const [relays, setRelays] = useState<RelayListEntry[]>([]);
  const [relayListRead, setRelayListRead] = useState<RelayListRead | null>(null);
  const [existing, setExisting] = useState<ExistingProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by every load. A load whose generation is no longer current
  // writes nothing: after an account switch, the previous account's late
  // answer must not become this account's profile or relay list, which the
  // next save would then publish signed by this account (review of !263).
  const generationRef = useRef(0);

  // Promise-chained rather than async/await: every setState call needs to run
  // from inside a .then()/.catch()/.finally() callback, not synchronously in
  // load's own body -- react-hooks/set-state-in-effect flags a setState
  // reachable synchronously from the effect below even when it is behind an
  // await, since statically that is indistinguishable from an unconditional
  // render-triggering update.
  const load = useCallback((): Promise<void> => {
    if (!fetchEvents || !pubkey) return Promise.resolve();

    const generation = ++generationRef.current;
    // Every state write below goes through this. A superseded load (another
    // load started, most often because the account changed) writes nothing.
    const current = () => generation === generationRef.current;

    // Not connected means we cannot know what exists. Recording `unreadable`
    // here is what stops a later save from publishing over a profile we never
    // managed to read.
    if (!isConnected) {
      return Promise.resolve().then(() => {
        if (!current()) return;
        setExisting({ status: 'unreadable' });
        setRelayListRead('unreadable');
      });
    }

    // Set once the relay list itself has been read, so a later failure reading
    // the profile from those relays does not condemn a list we did get.
    let relayListSettled = false;

    return Promise.resolve()
      .then(() => {
        if (!current()) return;
        setIsLoading(true);
        setError(null);
        // A new read, possibly for a different account: the last answers no
        // longer say what a save would replace.
        setExisting(null);
        setRelayListRead(null);
      })
      .then(() =>
        Promise.all([
          fetchEvents({ kinds: [METADATA_KIND], authors: [pubkey], limit: 10 }),
          fetchEvents({ kinds: [RELAY_LIST_KIND], authors: [pubkey], limit: 10 }),
        ])
      )
      .then(async ([metadataEvents, relayEvents]) => {
        if (!current()) return;

        // Space's pool having no list is not the user having none: it may
        // live only on relays we cannot reach. Ask the public indexers before
        // calling it absent, and if none of them answers, it is unreadable.
        let newestRelayList = newestOf(relayEvents);
        let relayListState: RelayListRead = 'found';
        if (!newestRelayList) {
          const indexed =
            service && subscribe
              ? await readIndexedRelayList(subscribe as unknown as SubscribeLike, service, pubkey)
              : { events: [] as NDKEvent[], answered: false };
          if (!current()) return;
          newestRelayList = newestOf(indexed.events);
          relayListState = newestRelayList ? 'found' : indexed.answered ? 'absent' : 'unreadable';
        }

        const relayList = newestRelayList ? parseRelayListTags(newestRelayList.tags ?? []) : [];
        setRelays(relayList);
        setRelayListRead(relayListState);
        relayListSettled = true;
        if (relayListState === 'unreadable') {
          setError(
            'Could not read your relay list: no relay or relay-list indexer answered. Saving it is disabled so it cannot replace a list kept elsewhere.',
          );
        }

        // kind:0 is replaceable, so a save publishes the whole profile, built
        // on the newest one seen. With a relay list, every write relay is
        // asked as well as Space's pool, and the newest across all of them
        // wins; the first to arrive may be older than what a slow relay holds.
        const writeUrls = relayList.filter((r) => r.write).map((r) => r.url);
        const own =
          writeUrls.length && service && subscribe
            ? await readOwnRelayProfiles(subscribe as unknown as SubscribeLike, service, writeUrls, pubkey)
            : // No relay list: Space's pool is all there is to ask. If it had
              // nothing, creating a profile from scratch is safe; treating this
              // as unreadable would mean a user with no kind:0 could never make
              // one, the bug cloistr-stash had to fix in this same code path.
              { events: [] as NDKEvent[], silent: [] as string[] };
        if (!current()) return;

        const newest = newestOf([...Array.from(metadataEvents), ...own.events]);
        if (newest) {
          const content = newest.content ?? '';
          setExisting({ status: 'found', content });
          setProfile(parseProfileContent(content));
          return;
        }

        // Nothing anywhere. Only "absent" when every write relay said so;
        // silence is never absent.
        if (own.silent.length > 0) {
          setExisting({ status: 'unreadable' });
          setProfile({});
          setError(
            `Could not read your profile: ${own.silent.join(', ')} did not answer. Saving is disabled so it cannot replace a profile kept there.`,
          );
          return;
        }

        setExisting({ status: 'absent' });
        setProfile({});
      })
      .catch((err) => {
        if (!current()) return;
        // We reached for it and failed. Explicitly NOT `absent`.
        setExisting({ status: 'unreadable' });
        if (!relayListSettled) setRelayListRead('unreadable');
        setError(err instanceof Error ? err.message : 'Could not read your profile');
      })
      .finally(() => {
        if (current()) setIsLoading(false);
      });
  }, [fetchEvents, pubkey, isConnected, service, subscribe]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProfile = useCallback(
    async (updates: ProfileFields) => {
      if (!createEvent || !publish || !pubkey) {
        throw new Error('Not signed in');
      }

      // The guard. A kind:0 replaces the previous one wholesale, so publishing
      // one built without the existing content deletes every field this form
      // does not carry -- across every client, not just here. Refuse rather
      // than destroy. `absent` is fine: nothing exists to lose.
      //
      // Residual risk worth naming: fetchEvents resolves empty both when relays
      // answered with nothing and when none of the relays holding the profile
      // were reachable. Connectivity is checked in load() to narrow that, and
      // outbox now queries the user's own relays rather than one hardcoded one,
      // but a user whose profile lives solely on a relay that is down while
      // another is up can still read as `absent`. Narrowing that further needs
      // per-relay EOSE accounting that NDK does not surface here.
      if (!existing || existing.status === 'unreadable') {
        throw new Error(
          'Could not read your current profile, so saving was cancelled to avoid ' +
            'overwriting fields set in other apps. Check your relay connection and try again.'
        );
      }

      setIsSaving(true);
      setError(null);

      try {
        const content = mergeProfileContent(
          existing.status === 'found' ? existing.content : '',
          updates
        );

        const event = createEvent();
        if (!event) throw new Error('Could not create event');

        event.kind = METADATA_KIND;
        event.content = content;
        event.tags = [];

        await publish(event);

        // Adopt what we just published as the new base, so a second save in the
        // same session merges onto it rather than onto the pre-edit copy.
        setExisting({ status: 'found', content });
        setProfile(parseProfileContent(content));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save your profile');
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [createEvent, publish, pubkey, existing]
  );

  const saveRelays = useCallback(
    async (entries: RelayListEntry[]) => {
      if (!createEvent || !publish || !pubkey) {
        throw new Error('Not signed in');
      }

      // Same guard as saveProfile, for the same reason: kind:10002 replaces
      // the user's relay list in every Nostr app, and the page's draft starts
      // empty. Saved before the read settled, or after it failed, the list
      // published is only what was typed here, and every other relay is gone.
      // Same residual risk as saveProfile too: an empty answer from Space's
      // pool reads as `absent` even if the list lives only on a relay that is
      // down.
      if (relayListRead !== 'found' && relayListRead !== 'absent') {
        throw new Error(
          'Could not read your current relay list, so saving was cancelled to avoid ' +
            'replacing it. Check your relay connection and try again.'
        );
      }

      setIsSaving(true);
      setError(null);

      try {
        const tags = buildRelayListTags(entries);

        // Add the declared relays to the NDK pools BEFORE publishing.
        // setConfiguredRelays puts them in both the main and outbox pools and
        // marks them tier 1 for auth (it calls setTrustedRelays internally).
        // Without this, a new user whose pool contains only our default relay
        // publishes the kind:10002 to that single relay alone. If that relay
        // refuses (whitelist), nothing is stored; even if it accepts, the user's
        // declared relays are never reachable for subsequent operations, and the
        // next resolution finds nothing, creating a permanent bootstrap deadlock.
        //
        // This means a failed publish leaves the pools holding relays the
        // persisted list does not. That is deliberate: a retry against the
        // expanded pool can succeed, whereas restoring the old pool would
        // reproduce the deadlock. setRelays (the persisted state) runs only
        // after publish succeeds, so the two converge on success.
        const urls = entries.map((e) => e.url);
        service?.setConfiguredRelays(urls);

        const event = createEvent();
        if (!event) throw new Error('Could not create event');

        event.kind = RELAY_LIST_KIND;
        event.content = '';
        event.tags = tags;

        await publish(event);

        setRelays(entries);
        setRelayListRead('found');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save your relay list');
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [createEvent, publish, pubkey, service, relayListRead]
  );

  return {
    profile,
    relays,
    relayListRead,
    existing,
    isLoading,
    isSaving,
    error,
    reload: load,
    saveProfile,
    saveRelays,
  };
}
