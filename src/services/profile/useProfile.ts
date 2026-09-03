/**
 * @fileoverview Read and publish the signed-in user's kind:0 and kind:10002.
 *
 * All signing is client-side through the existing session signer. Backends
 * never publish events on a user's behalf -- see the Cloistr development
 * philosophy doc.
 */

import { useCallback, useEffect, useState } from 'react';
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

export function useProfile(): UseProfileReturn {
  const { fetchEvents, createEvent, publish, isConnected, service } = useNdk();
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
      .then(([metadataEvents, relayEvents]) => {
        const newestMetadata = newestOf(metadataEvents);

        if (newestMetadata) {
          const content = newestMetadata.content ?? '';
          setExisting({ status: 'found', content });
          setProfile(parseProfileContent(content));
        } else {
          // A relay answered and had nothing. Creating a profile from scratch is
          // safe -- there is nothing to overwrite. Treating this as unreadable
          // would mean a user with no kind:0 could never make one, which is the
          // bug cloistr-stash had to fix in this same code path.
          setExisting({ status: 'absent' });
          setProfile({});
        }

        const newestRelayList = newestOf(relayEvents);
        setRelays(newestRelayList ? parseRelayListTags(newestRelayList.tags ?? []) : []);
      })
      .catch((err) => {
        // We reached for it and failed. Explicitly NOT `absent`.
        setExisting({ status: 'unreadable' });
        setError(err instanceof Error ? err.message : 'Could not read your profile');
      })
      .finally(() => setIsLoading(false));
  }, [fetchEvents, pubkey, isConnected]);

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

        const event = createEvent();
        if (!event) throw new Error('Could not create event');

        event.kind = RELAY_LIST_KIND;
        event.content = '';
        event.tags = tags;

        await publish(event);

        setRelays(entries);

        // The relays the user just declared are theirs, so they become tier 1
        // for auth: always authenticated, and exempt from the auth setting.
        // Without this the app would keep treating a newly added personal relay
        // as a stranger until reload.
        service?.getAuthPolicy().setTrustedRelays(entries.map((e) => e.url));
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
