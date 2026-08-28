/**
 * @fileoverview Pure builders and parsers for profile-related Nostr events.
 *
 * Kept free of React and NDK so the parts that can destroy user data are
 * testable on their own. The merge logic here is the reason this file exists:
 * a kind:0 is a REPLACEMENT event, so publishing one built from only the fields
 * a form knows about silently deletes every field it does not.
 *
 * Covers kind:0 (NIP-01 metadata) and kind:10002 (NIP-65 relay list).
 */

/** NIP-01 profile metadata. */
export const METADATA_KIND = 0;

/** NIP-65 relay list metadata. */
export const RELAY_LIST_KIND = 10002;

/**
 * The profile fields this app edits.
 *
 * Deliberately not the whole of what a kind:0 may contain -- see
 * mergeProfileContent, which preserves everything outside this set.
 */
export interface ProfileFields {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
}

export const EDITABLE_PROFILE_FIELDS: (keyof ProfileFields)[] = [
  'name',
  'display_name',
  'about',
  'picture',
  'banner',
  'website',
  'nip05',
  'lud16',
];

/**
 * Outcome of reading the existing profile before writing a new one.
 *
 * The three states are distinct on purpose and must not be collapsed:
 *
 * - `found`    we read it; merge onto it.
 * - `absent`   relays answered and there is no profile; creating one is safe.
 * - `unreadable` we could not reach a relay; we do not know what exists.
 *
 * Conflating `absent` with `unreadable` is a bug in both directions. Treating
 * `unreadable` as `absent` wipes the user's profile everywhere. Treating
 * `absent` as `unreadable` means a user with no kind:0 can never create one --
 * which is exactly the bug cloistr-stash had to fix in this same code path.
 */
export type ExistingProfile =
  | { status: 'found'; content: string }
  | { status: 'absent' }
  | { status: 'unreadable' };

/**
 * Merge edited fields onto the existing kind:0 content.
 *
 * A kind:0's content is a JSON blob whose shape is open: clients put things
 * there that other clients never display and this app has never heard of.
 * Publishing `JSON.stringify(formValues)` would drop all of it. So the existing
 * object is the base, and only the keys being edited are written over it.
 *
 * An empty string is a deliberate clear and is written through as an empty
 * string. `undefined` means "not edited" and leaves whatever was there. That
 * distinction is why ProfileFields values are optional rather than defaulted.
 *
 * Unparseable existing content is treated as an empty object rather than
 * thrown on: some clients have historically written non-JSON there, and
 * refusing to edit a profile forever because of one bad byte is worse than
 * starting a clean object. Nothing recoverable is lost, since nothing in it
 * could be read in the first place.
 */
export function mergeProfileContent(existingContent: string, updates: ProfileFields): string {
  let base: Record<string, unknown> = {};

  if (existingContent) {
    try {
      const parsed: unknown = JSON.parse(existingContent);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through with an empty base.
    }
  }

  const merged: Record<string, unknown> = { ...base };

  for (const key of EDITABLE_PROFILE_FIELDS) {
    const value = updates[key];
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  return JSON.stringify(merged);
}

/**
 * Read the editable fields out of an existing kind:0 so a form can be filled.
 * Non-string values are ignored rather than coerced -- a number where a string
 * belongs is another client's data, and rendering it into an input would let
 * the user "edit" it into a different type on save.
 */
export function parseProfileContent(content: string): ProfileFields {
  if (!content) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  const source = parsed as Record<string, unknown>;
  const fields: ProfileFields = {};

  for (const key of EDITABLE_PROFILE_FIELDS) {
    const value = source[key];
    if (typeof value === 'string') {
      fields[key] = value;
    }
  }

  return fields;
}

/** One entry in a NIP-65 relay list. */
export interface RelayListEntry {
  url: string;
  read: boolean;
  write: boolean;
}

/**
 * Build NIP-65 `r` tags.
 *
 * Per NIP-65 a bare `["r", url]` means both read and write, and the marker is
 * only present when the relay is one-directional. Emitting `["r", url, "read",
 * "write"]` or two separate tags would be wrong, and some clients only check
 * tag[2].
 *
 * Entries that are neither read nor write are dropped: that is a removal
 * expressed through the form, not a relay to publish with no role.
 */
export function buildRelayListTags(entries: RelayListEntry[]): string[][] {
  const tags: string[][] = [];

  for (const entry of entries) {
    const url = entry.url.trim();
    if (!url) continue;

    if (entry.read && entry.write) {
      tags.push(['r', url]);
    } else if (entry.read) {
      tags.push(['r', url, 'read']);
    } else if (entry.write) {
      tags.push(['r', url, 'write']);
    }
  }

  return tags;
}

/**
 * Parse NIP-65 `r` tags.
 *
 * A missing or unrecognised marker means both directions, which is the spec's
 * default. An unknown marker is treated as both rather than dropped, because
 * discarding a relay the user configured is worse than reading it permissively.
 *
 * Duplicate URLs are merged rather than repeated: a list carrying both
 * `["r", u, "read"]` and `["r", u, "write"]` describes one bidirectional relay,
 * and rendering it as two rows would let the user delete one and silently keep
 * the other.
 */
export function parseRelayListTags(tags: string[][]): RelayListEntry[] {
  const byUrl = new Map<string, RelayListEntry>();

  for (const tag of tags) {
    if (tag[0] !== 'r' || !tag[1]) continue;

    const url = tag[1].trim();
    if (!url) continue;

    const marker = tag[2];
    const read = marker !== 'write';
    const write = marker !== 'read';

    const existing = byUrl.get(url);
    if (existing) {
      existing.read = existing.read || read;
      existing.write = existing.write || write;
    } else {
      byUrl.set(url, { url, read, write });
    }
  }

  return [...byUrl.values()];
}

/**
 * Relays to publish a relay list TO.
 *
 * Chicken-and-egg: the event announcing where to find someone has to reach
 * relays that are already being read, or nobody learns the new list. So it goes
 * to the union of the relays currently connected and the write relays the user
 * just declared -- the old set so existing followers see the change, the new
 * set so it is present where the user is moving to.
 */
export function relayListPublishTargets(
  currentRelays: string[],
  entries: RelayListEntry[]
): string[] {
  const targets = new Set(currentRelays.map((u) => u.trim()).filter(Boolean));

  for (const entry of entries) {
    if (entry.write && entry.url.trim()) {
      targets.add(entry.url.trim());
    }
  }

  return [...targets];
}
