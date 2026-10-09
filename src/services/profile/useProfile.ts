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
import { useAuthStore } from '@/stores/authStore';
import { useAuth } from '@/components/auth/AuthProvider';
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

/** How the kind:10002 read went. Same three states as ExistingProfile. */
export type RelayListRead =
  | { status: 'found'; entries: RelayListEntry[] }
  | { status: 'absent' }
  | { status: 'unreadable' };

export interface UseProfileReturn {
  profile: ProfileFields;
  relays: RelayListEntry[];
  /**
   * How the existing profile read went, for the signed-in key and signer.
   * Null until a read for this key has finished. Gates whether saving is safe.
   */
  existing: ExistingProfile | null;
  /** The same for the relay list. Null until a read for this key has finished. */
  relayList: RelayListRead | null;
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

/**
 * A read only counts for the key and signer it was made with. Header sign-in
 * and key switches change both without remounting anything, so a read held
 * over from the previous key must read as "not loaded", never as the new
 * key's data -- or a save would publish key A's list under key B.
 */
interface ProfileReadResult {
  pubkey: string;
  signer: unknown;
  existing: ExistingProfile;
  relayList: RelayListRead;
  fields: ProfileFields;
  relays: RelayListEntry[];
}

/** Stable empties, so the editor's identity-based re-seeding does not churn. */
const NO_FIELDS: ProfileFields = {};
const NO_RELAYS: RelayListEntry[] = [];

/**
 * How long a read may take before it counts as failed. A relay that never
 * answers must not leave the form looking like the user has no relays.
 */
export const PROFILE_READ_TIMEOUT_MS = 15_000;

function withReadTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('No relay answered while reading your profile and relay list.')),
      PROFILE_READ_TIMEOUT_MS
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
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
  const { signer } = useAuth();

  const [read, setRead] = useState<ProfileReadResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each load gets a number; only the newest may record its result, so a slow
  // read for a previous key cannot land after a switch.
  const loadSeq = useRef(0);

  const current = read && read.pubkey === pubkey && read.signer === signer ? read : null;
  const existing = current?.existing ?? null;
  const relayList = current?.relayList ?? null;
  const profile = current?.fields ?? NO_FIELDS;
  const relays = current?.relays ?? NO_RELAYS;

  // Promise-chained rather than async/await: every setState call needs to run
  // from inside a .then()/.catch()/.finally() callback, not synchronously in
  // load's own body -- react-hooks/set-state-in-effect flags a setState
  // reachable synchronously from the effect below even when it is behind an
  // await, since statically that is indistinguishable from an unconditional
  // render-triggering update.
  const load = useCallback((): Promise<void> => {
    if (!fetchEvents || !pubkey) return Promise.resolve();
    const seq = ++loadSeq.current;
    const isNewest = () => seq === loadSeq.current;

    const unreadable = (): ProfileReadResult => ({
      pubkey,
      signer,
      existing: { status: 'unreadable' },
      relayList: { status: 'unreadable' },
      fields: NO_FIELDS,
      relays: NO_RELAYS,
    });

    // Not connected means we cannot know what exists. Recording `unreadable`
    // here is what stops a later save from publishing over a profile or relay
    // list we never managed to read.
    if (!isConnected) {
      return Promise.resolve().then(() => {
        if (!isNewest()) return;
        setRead(unreadable());
        // A superseded connected load skips its own finally, so this one must
        // clear the flag or the form stays on "Loading" with no way to retry.
        setIsLoading(false);
      });
    }

    return Promise.resolve()
      .then(() => {
        setIsLoading(true);
        setError(null);
      })
      .then(() =>
        withReadTimeout(
          Promise.all([
            fetchEvents({ kinds: [METADATA_KIND], authors: [pubkey], limit: 10 }),
            fetchEvents({ kinds: [RELAY_LIST_KIND], authors: [pubkey], limit: 10 }),
          ])
        )
      )
      .then(async ([metadataEvents, relayEvents]) => {
        if (!isNewest()) return;
        const newestRelayList = newestOf(relayEvents);
        const entries = newestRelayList ? parseRelayListTags(newestRelayList.tags ?? []) : NO_RELAYS;
        const relayList: RelayListRead = newestRelayList ? { status: 'found', entries } : { status: 'absent' };
        const record = (existing: ExistingProfile, fields: ProfileFields) =>
          setRead({ pubkey, signer, existing, relayList, fields, relays: entries });

        // kind:0 is replaceable, so a save publishes the whole profile, built
        // on the newest one seen. With a relay list, every write relay is
        // asked as well as Space's pool, and the newest across all of them
        // wins; the first to arrive may be older than what a slow relay holds.
        const writeUrls = entries.filter((r) => r.write).map((r) => r.url);
        const own =
          writeUrls.length && service && subscribe
            ? await readOwnRelayProfiles(subscribe as unknown as SubscribeLike, service, writeUrls, pubkey)
            : // No relay list: Space's pool is all there is to ask. If it had
              // nothing, creating a profile from scratch is safe; treating this
              // as unreadable would mean a user with no kind:0 could never make
              // one, the bug cloistr-stash had to fix in this same code path.
              { events: [] as NDKEvent[], silent: [] as string[] };

        // The per-relay reads are their own wait; a newer load may have started.
        if (!isNewest()) return;

        const newest = newestOf([...Array.from(metadataEvents), ...own.events]);
        if (newest) {
          const content = newest.content ?? '';
          record({ status: 'found', content }, parseProfileContent(content));
          return;
        }

        // Nothing anywhere. Only "absent" when every write relay said so;
        // silence is never absent. The relay list itself was read, so it
        // stays as read.
        if (own.silent.length > 0) {
          record({ status: 'unreadable' }, NO_FIELDS);
          setError(
            `Could not read your profile: ${own.silent.join(', ')} did not answer. Saving is disabled so it cannot replace a profile kept there.`,
          );
          return;
        }

        record({ status: 'absent' }, NO_FIELDS);
      })
      .catch((err) => {
        if (!isNewest()) return;
        // We reached for it and failed, or nobody answered in time. Explicitly
        // NOT `absent`.
        setRead(unreadable());
        setError(err instanceof Error ? err.message : 'Could not read your profile');
      })
      .finally(() => {
        if (isNewest()) setIsLoading(false);
      });
  }, [fetchEvents, pubkey, signer, isConnected, service, subscribe]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Adopt what a save just published as the new base. Only onto the read it
   * was made against: if the key or signer changed while the publish was in
   * flight, that read is gone and the result belongs to the old key, so it is
   * dropped rather than recorded as the new key's data. A null `prev` is the
   * same case (nothing current to update), not a read to construct.
   */
  const adopt = useCallback(
    (forPubkey: string, forSigner: unknown, patch: Partial<ProfileReadResult>) => {
      setRead((prev) =>
        prev && prev.pubkey === forPubkey && prev.signer === forSigner ? { ...prev, ...patch } : prev
      );
    },
    []
  );

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
        adopt(pubkey, signer, {
          existing: { status: 'found', content },
          fields: parseProfileContent(content),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save your profile');
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [createEvent, publish, pubkey, signer, existing, adopt]
  );

  const saveRelays = useCallback(
    async (entries: RelayListEntry[]) => {
      if (!createEvent || !publish || !pubkey) {
        throw new Error('Not signed in');
      }

      // The guard. A kind:10002 replaces the user's whole relay list on every
      // relay and in every Nostr app. `entries` is the editor's draft, seeded
      // from the read; if that read is pending, failed, timed out, or belongs
      // to another key, the draft is not the user's list and publishing it
      // replaces the real one. `absent` is fine: a relay answered and the user
      // has none, so there is nothing to lose.
      if (!relayList || relayList.status === 'unreadable') {
        const message =
          'Could not read your current relay list, so saving was cancelled to avoid ' +
          'replacing it. Check your relay connection and try again.';
        setError(message);
        throw new Error(message);
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
        // reproduce the deadlock. The read state (what the form shows) changes only
        // after publish succeeds, so the two converge on success.
        const urls = entries.map((e) => e.url);
        service?.setConfiguredRelays(urls);

        const event = createEvent();
        if (!event) throw new Error('Could not create event');

        event.kind = RELAY_LIST_KIND;
        event.content = '';
        event.tags = tags;

        await publish(event);

        adopt(pubkey, signer, { relayList: { status: 'found', entries }, relays: entries });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save your relay list');
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [createEvent, publish, pubkey, signer, service, relayList, adopt]
  );

  return {
    profile,
    relays,
    existing,
    relayList,
    isLoading,
    isSaving,
    error,
    reload: load,
    saveProfile,
    saveRelays,
  };
}
