/**
 * @fileoverview Profile view -- edits the user's Nostr identity.
 *
 * Owns kind:0 (NIP-01 metadata) and kind:10002 (NIP-65 relay list). Identity
 * presentation lives in Space; me.cloistr.xyz keeps the account and namespace
 * side (NIP-05 registration, Lightning address, address transfer, credits).
 * Operator decision, 2026-08-26.
 */

import { useState, useCallback } from 'react';
import { useProfile } from '@/services/profile';
import type { ProfileFields, RelayListEntry } from '@/services/profile';
import { useNdk } from '@/services/nostr';

const FIELD_LABELS: { key: keyof ProfileFields; label: string; hint?: string; multiline?: boolean }[] =
  [
    { key: 'display_name', label: 'Display name', hint: 'Shown to other people' },
    { key: 'name', label: 'Username', hint: 'Short handle, no spaces' },
    { key: 'about', label: 'About', multiline: true },
    { key: 'picture', label: 'Avatar URL' },
    { key: 'banner', label: 'Banner URL' },
    { key: 'website', label: 'Website' },
    { key: 'nip05', label: 'NIP-05 address', hint: 'e.g. you@cloistr.xyz' },
    { key: 'lud16', label: 'Lightning address', hint: 'For zaps' },
  ];

export function ProfileView() {
  const { profile, relays, existing, isLoading, isSaving, error, reload, saveProfile, saveRelays } =
    useProfile();
  const { service } = useNdk();

  const [draft, setDraft] = useState<ProfileFields>({});
  const [relayDraft, setRelayDraft] = useState<RelayListEntry[]>([]);
  const [newRelayUrl, setNewRelayUrl] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // The auth setting from fc863561. Read once from the live policy so the
  // control reflects actual behaviour rather than a duplicate copy of it.
  const [authEnabled, setAuthEnabled] = useState(
    () => service?.getAuthPolicy().isEnabled() ?? true
  );

  // Seed the editable drafts from whatever was last loaded or saved, without
  // clobbering in-progress edits on every render.
  //
  // Done by comparing against the last value we synced from rather than in an
  // effect: an effect would render once with stale inputs and then immediately
  // re-render, and it is what react-hooks/set-state-in-effect exists to catch.
  // `profile` and `relays` only change identity when useProfile actually
  // replaces them, so reference equality is the right test.
  const [syncedProfile, setSyncedProfile] = useState<ProfileFields | null>(null);
  if (profile !== syncedProfile) {
    setSyncedProfile(profile);
    setDraft(profile);
  }

  const [syncedRelays, setSyncedRelays] = useState<RelayListEntry[] | null>(null);
  if (relays !== syncedRelays) {
    setSyncedRelays(relays);
    setRelayDraft(relays);
  }

  const blocked = !existing || existing.status === 'unreadable';

  const handleSaveProfile = useCallback(async () => {
    try {
      await saveProfile(draft);
      setSavedNotice('Profile saved.');
    } catch {
      // useProfile surfaces the message through `error`.
    }
  }, [draft, saveProfile]);

  const handleSaveRelays = useCallback(async () => {
    try {
      await saveRelays(relayDraft);
      setSavedNotice('Relay list saved.');
    } catch {
      // As above.
    }
  }, [relayDraft, saveRelays]);

  const addRelay = useCallback(() => {
    const url = newRelayUrl.trim();
    if (!url) return;
    if (relayDraft.some((r) => r.url === url)) {
      setNewRelayUrl('');
      return;
    }
    setRelayDraft((prev) => [...prev, { url, read: true, write: true }]);
    setNewRelayUrl('');
  }, [newRelayUrl, relayDraft]);

  const toggleAuth = useCallback(
    (next: boolean) => {
      setAuthEnabled(next);
      service?.getAuthPolicy().setEnabled(next);
    },
    [service]
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div>
        <h1 className="text-xl font-medium text-cloistr-light">Profile</h1>
        <p className="mt-1 text-sm text-cloistr-light/60">
          Your Nostr identity. These are signed events, so they follow you to every Nostr app --
          not just this one.
        </p>
      </div>

      {isLoading && <p className="text-sm text-cloistr-light/60">Loading your profile…</p>}

      {/* The clobber guard, surfaced. A kind:0 replaces the previous one
          wholesale, so saving without having read the current one would delete
          every field set in other apps. Saying so beats a disabled button with
          no explanation. */}
      {!isLoading && blocked && (
        <div className="rounded-lg border border-cloistr-warning/40 bg-cloistr-warning/10 p-4">
          <h3 className="mb-1 text-sm font-medium text-cloistr-light">
            Editing is paused until we can read your current profile
          </h3>
          <p className="text-sm text-cloistr-light/70">
            Saving now could erase details you set in another Nostr app, because a profile update
            replaces the whole profile rather than changing one field. Check your relay connection
            and reload.
          </p>
          <button
            onClick={() => void reload()}
            className="mt-3 rounded bg-cloistr-primary/20 px-3 py-1.5 text-xs text-cloistr-primary hover:bg-cloistr-primary/30"
          >
            Try again
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-cloistr-error/40 bg-cloistr-error/10 p-3 text-sm text-cloistr-light/80">
          {error}
        </div>
      )}

      {savedNotice && !error && (
        <div className="rounded-lg border border-cloistr-success/40 bg-cloistr-success/10 p-3 text-sm text-cloistr-light/80">
          {savedNotice}
        </div>
      )}

      {/* Profile fields */}
      <section className="rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-4">
        <h2 className="mb-3 text-sm font-medium text-cloistr-light">Details</h2>

        <div className="space-y-3">
          {FIELD_LABELS.map(({ key, label, hint, multiline }) => (
            <label key={key} className="block">
              <span className="text-xs text-cloistr-light/60">{label}</span>
              {multiline ? (
                <textarea
                  rows={3}
                  disabled={blocked}
                  value={draft[key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  className="mt-1 w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light disabled:opacity-50"
                />
              ) : (
                <input
                  type="text"
                  disabled={blocked}
                  value={draft[key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  className="mt-1 w-full rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light disabled:opacity-50"
                />
              )}
              {hint && <span className="mt-0.5 block text-xs text-cloistr-light/40">{hint}</span>}
            </label>
          ))}
        </div>

        <button
          onClick={() => void handleSaveProfile()}
          disabled={blocked || isSaving}
          className="mt-4 rounded bg-cloistr-primary px-4 py-2 text-sm text-cloistr-dark disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save profile'}
        </button>
      </section>

      {/* Relay list */}
      <section className="rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-4">
        <h2 className="mb-1 text-sm font-medium text-cloistr-light">Relays</h2>
        <p className="mb-3 text-xs text-cloistr-light/50">
          Where your notes are published and where other apps look for them. Publishing this list
          is how the rest of Nostr finds you.
        </p>

        <div className="space-y-2">
          {relayDraft.length === 0 && (
            <p className="text-sm text-cloistr-light/50">No relays listed yet.</p>
          )}

          {relayDraft.map((relay, index) => (
            <div key={relay.url} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate text-cloistr-light/80" title={relay.url}>
                {relay.url}
              </span>

              {(['read', 'write'] as const).map((dir) => (
                <label key={dir} className="flex items-center gap-1 text-xs text-cloistr-light/60">
                  <input
                    type="checkbox"
                    checked={relay[dir]}
                    onChange={(e) =>
                      setRelayDraft((prev) =>
                        prev.map((r, i) => (i === index ? { ...r, [dir]: e.target.checked } : r))
                      )
                    }
                  />
                  {dir}
                </label>
              ))}

              <button
                onClick={() => setRelayDraft((prev) => prev.filter((_, i) => i !== index))}
                className="text-xs text-cloistr-error/80 hover:text-cloistr-error"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={newRelayUrl}
            placeholder="wss://relay.example.com"
            onChange={(e) => setNewRelayUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRelay()}
            className="flex-1 rounded border border-cloistr-light/10 bg-cloistr-light/5 p-2 text-sm text-cloistr-light"
          />
          <button
            onClick={addRelay}
            className="rounded bg-cloistr-light/10 px-3 text-sm text-cloistr-light hover:bg-cloistr-light/20"
          >
            Add
          </button>
        </div>

        <button
          onClick={() => void handleSaveRelays()}
          disabled={isSaving}
          className="mt-4 rounded bg-cloistr-primary px-4 py-2 text-sm text-cloistr-dark disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save relay list'}
        </button>
      </section>

      {/* Privacy */}
      <section className="rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-4">
        <h2 className="mb-3 text-sm font-medium text-cloistr-light">Privacy</h2>

        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm text-cloistr-light">
              Let relays verify who you are
            </span>
            <span className="mt-0.5 block text-xs text-cloistr-light/50">
              Recommended. Some relays only serve posts to people who identify themselves, so
              turning this off means a less complete feed. Your own relays always verify, since
              otherwise they will not deliver your messages.
            </span>
          </span>
          <input
            type="checkbox"
            checked={authEnabled}
            onChange={(e) => toggleAuth(e.target.checked)}
            className="mt-1"
          />
        </label>
      </section>
    </div>
  );
}
