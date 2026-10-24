/**
 * @fileoverview Read and publish the signed-in user's kind:0 and kind:10002.
 *
 * All signing is client-side through the existing session signer. Backends
 * never publish events on a user's behalf -- see the Cloistr development
 * philosophy doc.
 */

import { useCallback, useEffect, useState } from 'react';
import type { NDKEvent, NDKFilter, NDKRelaySet } from '@nostr-dev-kit/ndk';
import { useNdk } from '@/services/nostr';
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
      [{ kinds: [METADATA_KIND], authors: [pubkey], limit: 5 }],
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

export function useProfile(): UseProfileReturn {
  const { fetchEvents, createEvent, publish, isConnected, service, subscribe } = useNdk();
  const pubkey = useAuthStore((s) => s.pubkey);

  const [profile, setProfile] = useState<ProfileFields>({});
  const [relays, setRelays] = useState<RelayListEntry[]>([]);
  const [existing, setExisting] = useState<ExistingProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Promise-chained rather than async/await: every setState call needs to run
  // from inside a .then()/.catch()/.finally() callback, not synchronously in
  // load's own body -- react-hooks/set-state-in-effect flags a setState
  // reachable synchronously from the effect below even when it is behind an
  // await, since statically that is indistinguishable from an unconditional
  // render-triggering update.
  const load = useCallback((): Promise<void> => {
    if (!fetchEvents || !pubkey) return Promise.resolve();

    // Not connected means we cannot know what exists. Recording `unreadable`
    // here is what stops a later save from publishing over a profile we never
    // managed to read.
    if (!isConnected) {
      return Promise.resolve().then(() => {
        setExisting({ status: 'unreadable' });
      });
    }

    return Promise.resolve()
      .then(() => {
        setIsLoading(true);
        setError(null);
      })
      .then(() =>
        Promise.all([
          fetchEvents({ kinds: [METADATA_KIND], authors: [pubkey], limit: 10 }),
          fetchEvents({ kinds: [RELAY_LIST_KIND], authors: [pubkey], limit: 10 }),
        ])
      )
      .then(async ([metadataEvents, relayEvents]) => {
        const newestRelayList = newestOf(relayEvents);
        const relayList = newestRelayList ? parseRelayListTags(newestRelayList.tags ?? []) : [];
        setRelays(relayList);

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
        // We reached for it and failed. Explicitly NOT `absent`.
        setExisting({ status: 'unreadable' });
        setError(err instanceof Error ? err.message : 'Could not read your profile');
      })
      .finally(() => setIsLoading(false));
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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save your relay list');
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [createEvent, publish, pubkey, service]
  );

  return {
    profile,
    relays,
    existing,
    isLoading,
    isSaving,
    error,
    reload: load,
    saveProfile,
    saveRelays,
  };
}
