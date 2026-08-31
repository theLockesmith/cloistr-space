/**
 * @fileoverview Survive a reload without a cache adapter.
 *
 * The complaint was narrow: reload the page and the feed is empty until relays
 * answer again. The obvious fix was an NDK cache adapter, and both candidates
 * turned out to bundle their own copy of NDK -- dexie by pinning it in
 * `dependencies`, sqlite-wasm by statically inlining it (its `index.mjs` has
 * ZERO imports; NDK and sql.js are compiled in). Either way you get a second
 * NDK with an `instanceof` boundary through it, and sqlite-wasm costs ~650 KB
 * gzipped on top.
 *
 * So this is deliberately NOT a cache. It is a render snapshot: the last N
 * notes we actually showed, written to sessionStorage, read back on mount so
 * there is something on screen while the live subscription refills.
 *
 * What that means, stated plainly because it is easy to forget later:
 *
 *   IT DOES NOT FEED NDK. Nothing here answers a filter, so it cannot make
 *   `remoteEntriesFound` in contactsSync any safer. The contact-list gate is
 *   exactly as exposed to empty-versus-unreachable as it was before. That
 *   protection has to come from the gate itself, not from a by-product of
 *   storage.
 *
 * sessionStorage rather than localStorage on purpose: restoring across a reload
 * is the ask. Restoring a week-old feed in a new tab and presenting it as
 * current is not, and sessionStorage bounds the lifetime for free instead of us
 * having to age entries out.
 */

import type { Note } from '@/types/social';

/**
 * Bumped whenever `Note` changes shape. An old payload is then simply not
 * found rather than being restored into fields that no longer exist -- cheaper
 * and more honest than migrating a throwaway render cache.
 */
const SNAPSHOT_VERSION = 2;

/** Roughly two screens. Enough to look restored; not enough to strain a quota. */
export const SNAPSHOT_LIMIT = 50;

/**
 * sessionStorage quotas are ~5 MB but are per-ORIGIN, shared with everything
 * else we keep there. Note content is user-controlled and unbounded, so a
 * handful of enormous notes could otherwise consume the lot.
 */
const MAX_BYTES = 256 * 1024;

interface SnapshotPayload {
  v: number;
  notes: Note[];
}

/**
 * Keyed by pubkey AND mode. Without the pubkey, signing out and back in as
 * someone else restores the previous account's feed; without the mode, the
 * global feed's contents surface under "following", which reads as a follow
 * list that is not yours.
 */
export function snapshotKey(mode: string, pubkey: string | null | undefined): string {
  return `cloistr:feed-snapshot:${mode}:${pubkey ?? 'anon'}`;
}

/** Minimal shape check. A corrupt or half-written entry must not reach render. */
function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) return false;
  const n = value as Partial<Note>;
  return (
    typeof n.id === 'string' &&
    typeof n.pubkey === 'string' &&
    typeof n.content === 'string' &&
    typeof n.createdAt === 'number' &&
    Array.isArray(n.mentions) &&
    Array.isArray(n.hashtags) &&
    Array.isArray(n.media) &&
    typeof n.engagement === 'object' &&
    n.engagement !== null
  );
}

/**
 * Persist the newest notes for this mode.
 *
 * Every failure is swallowed. Storage throws for reasons that have nothing to
 * do with us -- private browsing, disabled site data, quota -- and none of them
 * are a reason for the feed to break. A missing snapshot degrades to today's
 * behaviour, which is the thing we are improving on, not a regression.
 */
export function saveSnapshot(
  notes: Note[],
  mode: string,
  pubkey: string | null | undefined,
  storage?: Storage | null
): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;

  try {
    // Trim BEFORE serialising, then shrink further if the result is still too
    // big. Serialising all of them first to measure would mean building the
    // very string we are trying to avoid.
    let slice = notes.slice(0, SNAPSHOT_LIMIT);
    let json = JSON.stringify({ v: SNAPSHOT_VERSION, notes: slice } satisfies SnapshotPayload);

    while (json.length > MAX_BYTES && slice.length > 1) {
      slice = slice.slice(0, Math.floor(slice.length / 2));
      json = JSON.stringify({ v: SNAPSHOT_VERSION, notes: slice } satisfies SnapshotPayload);
    }

    // A single note over the cap: store nothing rather than throw at the quota.
    if (json.length > MAX_BYTES) return false;

    store.setItem(snapshotKey(mode, pubkey), json);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read back a snapshot, or an empty array if there is nothing usable.
 *
 * Returns [] for "absent", "corrupt", "wrong version" and "storage refused"
 * alike. That collapse is safe HERE, unlike everywhere else in this codebase,
 * because the caller's next action is identical in all four cases: show
 * nothing and wait for relays. It is not carrying a distinction anyone acts on.
 */
export function loadSnapshot(
  mode: string,
  pubkey: string | null | undefined,
  storage?: Storage | null
): Note[] {
  const store = resolveStorage(storage);
  if (!store) return [];

  try {
    const raw = store.getItem(snapshotKey(mode, pubkey));
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];

    const payload = parsed as Partial<SnapshotPayload>;
    if (payload.v !== SNAPSHOT_VERSION) return [];
    if (!Array.isArray(payload.notes)) return [];

    return payload.notes.filter(isNote).slice(0, SNAPSHOT_LIMIT);
  } catch {
    return [];
  }
}

/** Drop a snapshot -- on sign-out, so the next user does not inherit it. */
export function clearSnapshot(
  mode: string,
  pubkey: string | null | undefined,
  storage?: Storage | null
): void {
  try {
    resolveStorage(storage)?.removeItem(snapshotKey(mode, pubkey));
  } catch {
    // See saveSnapshot.
  }
}

/**
 * Insert a note, keyed by id, newest first.
 *
 * Dedup lives HERE rather than only in the caller's seen-set, and that is the
 * point. The feed kept a `seenIdsRef` beside the note list and appended
 * unconditionally once an id passed it -- two structures that had to agree, and
 * did not. The snapshot restore replaced the list and CLEARED the seen-set
 * without seeding it, so every restored note was delivered again by the live
 * subscription, passed the empty seen-set, and rendered a second time. Adjacent
 * identical pairs, same React key.
 *
 * Seeding the seen-set fixes that instance. Deduping at the insert makes the
 * whole class structurally impossible, which matters because the two
 * structures will drift again otherwis/**
 * Insert a note, keyed by id, newest first.
 *
 * Dedup lives HERE rather than only in the caller's seen-set, and that is the
 * point. The feed kept a `seenIdsRef` beside the note list and appended
 * unconditionally once an id passed it -- two structures that had to agree, and
 * did not. The snapshot restore replaced the list and CLEARED the seen-set
 * without seeding it, so every restored note was delivered again by the live
 * subscription, passed the empty seen-set, and rendered a second time. Adjacent
 * identical pairs, same React key.
 *
 * Seeding the seen-set fixes that instance. Deduping at the insert makes the
 * whole class structurally impossible.
 *
 * A redelivery of the same id is IGNORED, not merged. A Nostr event id is a
 * hash over pubkey, created_at, kind, tags and content, so a second copy is
 * byte-identical and carries nothing new -- while the note already in the list
 * has engagement counts and optimistic react/repost flags folded into it by
 * applyEngagement. Replacing it would reset reaction counts to zero and un-fill
 * a heart the user had just tapped, until the next engagement pass.
 *
 * Returning `prev` UNCHANGED also matters for renders: a new array on every
 * redelivery re-renders the whole feed, and with the outbox model one note
 * arrives from every relay that carries it.
 */
export function upsertNote(prev: Note[], note: Note): Note[] {
  if (prev.some((n) => n.id === note.id)) return prev;

  // Sort by the time the note entered the viewer\'s feed: for reposts that is
  // boostedAt (when the boost happened), for original notes it is createdAt.
  // Without this a repost of a 3-day-old note always sinks to the bottom even
  // though it was just boosted a second ago.
  return [...prev, note].sort((a, b) => {
    const ta = a.repostBy?.boostedAt ?? a.createdAt;
    const tb = b.repostBy?.boostedAt ?? b.createdAt;
    return tb - ta;
  });
}

/**
 * Whether `notes` may be written to `mode`'s snapshot.
 *
 * This exists because of a regression I shipped. Switching feed filters did not
 * clear `notes`, and the restore MERGED the new mode's snapshot into whatever
 * was already on screen -- so the union got saved under the new mode's key, and
 * the next switch grew it again. After visiting all three filters, every key
 * held the same union and all three rendered identically.
 *
 * The operator's report was exact: "only showing my content (except now it's
 * across all 3 view filters)". Three DIFFERENT filters returning ONE identical
 * result is a different shape from a feed being empty, and that parenthetical
 * is what identified it.
 *
 * So notes carry the mode they were fetched under, and a write is refused when
 * that does not match where it is going. Clearing on mode change (in useFeed)
 * is the primary fix; this is the guard that makes the invariant checkable
 * rather than merely intended.
 */
export function shouldPersist(
  notesMode: string | null,
  mode: string,
  noteCount: number
): boolean {
  // refresh() empties notes before refilling them. Writing that through would
  // destroy the snapshot at the moment it is most likely to be wanted.
  if (noteCount === 0) return false;
  // Notes belonging to another filter must never be written here.
  return notesMode === mode;
}

/**
 * Resolve the storage a caller meant.
 *
 * `undefined` means "not specified, use the ambient one"; `null` means
 * "explicitly none". A default parameter cannot express that difference --
 * passing undefined selects the default -- so a test could not ask for the
 * no-storage path at all, and would silently exercise jsdom's real
 * sessionStorage while appearing to test its absence.
 *
 * Which is this codebase's recurring bug wearing a function signature: two
 * different intents collapsing into one indistinguishable value.
 */
function resolveStorage(storage: Storage | null | undefined): Storage | undefined {
  if (storage === null) return undefined;
  return storage ?? safeStorage();
}

/** sessionStorage, or undefined where merely TOUCHING it throws. */
function safeStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
