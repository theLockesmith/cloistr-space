/**
 * @fileoverview NIP-51 emoji sets, resolved for the reaction picker.
 *
 * TWO HOPS, and this is the part that surprises people. kind:10030 (the user's
 * emoji list) does not usually contain the emoji. It contains `a` tags pointing
 * at kind:30030 sets, which hold them -- so a client that reads kind:10030,
 * finds no `emoji` tags, and concludes the user has none will be wrong for
 * almost everybody who has configured any.
 *
 * RENDERING POLICY: unicode is rendered; custom entries are shown as their
 * `:shortcode:` text and their images are NEVER fetched.
 *
 * That is a privacy decision, not a robustness one. NIP-51 sets are shared, so
 * a user's list routinely references sets published by strangers, and every
 * entry is an image URL on a host we do not control. Rendering them would fire
 * a request to each of those hosts at the moment the picker opens, disclosing
 * the user's IP -- and the fact that they were about to react -- to whoever
 * published the set. For a product whose pitch is escaping Big Tech, silently
 * loading third-party assets chosen by strangers is a regression against the
 * pitch. (Dead hosts are also a problem, but they are the visible symptom of
 * the smaller half.)
 *
 * Crucially this does NOT cost the user the feature. NIP-25 lets a reaction
 * carry `:shortcode:` as content plus a matching `["emoji", shortcode, url]`
 * tag, so we can publish a custom reaction faithfully -- other clients render
 * it from the tag -- while never loading the image ourselves. The two-hop
 * resolution therefore earns its keep even under a unicode-only picker.
 *
 * The upgrade path, when we want images, is to proxy them through our own
 * Blossom at files.cloistr.xyz, which we already run. That is separate work.
 *
 * OPERATOR'S OWN UNICODE FAVOURITES (emoji_native)
 *
 * NIP-51 only defines an `emoji` tag for CUSTOM (NIP-30) emoji -- shortcode
 * plus an image URL. There is no standard tag for "I like this unicode glyph,
 * put it near the top of my picker," so a kind:10030 editor that wants to let
 * the operator curate unicode favourites has to invent something.
 *
 * Reusing `emoji` for a unicode entry was considered and rejected. Every other
 * piece of this module keys the custom/unicode distinction off whether an
 * entry HAS a url (isRenderable, reactionPayload, the mirror-sign pipeline in
 * useMirrorSign) -- not off which tag name produced it. Writing
 * `['emoji', 'heart', '❤️']` would mean one of: teach every one of
 * those call sites to detect "this url is actually a glyph" (fragile, and the
 * detection would have to run forever, on every future caller), or accept that
 * such an entry gets silently handed to the mirror-sign flow, which expects an
 * http(s) image URL and would try to "resolve" a glyph as one.
 *
 * So this is a second, Cloistr-specific tag instead:
 *
 *   ['emoji_native', <shortcode>, <character>]
 *
 * on the user's OWN kind:10030 only -- never on a shared kind:30030 set, which
 * stays exactly what NIP-30 says it is. The format stays compatible with other
 * clients in the sense that matters: NIP-51 clients already have to skip tags
 * they don't recognise to parse a list written by a client ahead of them, so
 * an unrecognised `emoji_native` tag changes nothing about how another client
 * reads our `emoji` tags or our `a` pointers. It simply means other clients
 * don't (yet) show the unicode half of what we publish -- the same way we
 * don't show whatever private extension THEY might be writing today.
 */

export const EMOJI_LIST_KIND = 10030;
export const EMOJI_SET_KIND = 30030;

export interface EmojiEntry {
  /** Bare shortcode, no surrounding colons. */
  shortcode: string;
  /** Image URL for custom emoji. Absent for unicode. Never fetched by us. */
  url?: string;
  /** The literal character, for unicode entries. */
  native?: string;
}

/** A `30030:<pubkey>:<identifier>` coordinate from an `a` tag. */
export interface SetCoordinate {
  kind: number;
  pubkey: string;
  identifier: string;
}

/**
 * What we offer when the user has no kind:10030 at all, which is most people.
 *
 * An empty picker is indistinguishable from a broken one, and "you have no
 * emoji" is a strange thing to tell someone who never opted into a spec they
 * have not heard of.
 */
export const FALLBACK_EMOJI: EmojiEntry[] = [
  { shortcode: 'heart', native: '❤️' },
  { shortcode: '+1', native: '👍' },
  { shortcode: '-1', native: '👎' },
  { shortcode: 'joy', native: '😂' },
  { shortcode: 'thinking', native: '🤔' },
  { shortcode: 'fire', native: '🔥' },
  { shortcode: 'tada', native: '🎉' },
  { shortcode: 'eyes', native: '👀' },
  { shortcode: 'pray', native: '🙏' },
  { shortcode: 'rocket', native: '🚀' },
  { shortcode: 'zap', native: '⚡' },
  { shortcode: 'sad', native: '😢' },
];

/**
 * Read `["emoji", shortcode, url]` tags.
 *
 * Malformed tags are skipped rather than partially accepted: an entry with a
 * shortcode and no URL cannot be rendered OR published correctly, so admitting
 * it only moves the failure somewhere less obvious.
 */
export function parseEmojiTags(tags: string[][]): EmojiEntry[] {
  const out: EmojiEntry[] = [];

  for (const tag of tags) {
    if (tag[0] !== 'emoji') continue;
    const shortcode = tag[1];
    const url = tag[2];
    if (typeof shortcode !== 'string' || shortcode.length === 0) continue;
    if (typeof url !== 'string' || url.length === 0) continue;
    out.push({ shortcode, url });
  }

  return out;
}

/** The tag name for the operator's own unicode favourites. See the docblock above. */
export const EMOJI_NATIVE_TAG = 'emoji_native';

/** True for a well-formed `['emoji', shortcode, url]` tag. */
function isCustomEmojiTag(tag: string[]): boolean {
  return (
    tag[0] === 'emoji' &&
    typeof tag[1] === 'string' &&
    tag[1].length > 0 &&
    typeof tag[2] === 'string' &&
    tag[2].length > 0
  );
}

/** True for a well-formed `['emoji_native', shortcode, character]` tag. */
function isNativeEmojiTag(tag: string[]): boolean {
  return (
    tag[0] === EMOJI_NATIVE_TAG &&
    typeof tag[1] === 'string' &&
    tag[1].length > 0 &&
    typeof tag[2] === 'string' &&
    tag[2].length > 0
  );
}

/**
 * True for any direct-entry tag the emoji list editor manages.
 *
 * Exported so emojiListService can preserve everything ELSE (malformed
 * `emoji` tags, `a` pointers, and anything neither of us recognises) byte for
 * byte rather than re-deriving this module's idea of "well-formed" a second
 * time in a different file.
 */
export function isManagedEmojiTag(tag: string[]): boolean {
  return isCustomEmojiTag(tag) || isNativeEmojiTag(tag);
}

/**
 * Read a user's own direct entries -- both custom (`emoji`) and unicode
 * (`emoji_native`) -- in the order they appear on the event.
 *
 * This is NOT the same as `mergeEmoji(parseUnicode(tags), parseEmojiTags(tags))`:
 * that would group all unicode before all custom (or vice versa) regardless of
 * how the user ordered their list. The editor's reorder feature is only
 * visible to the picker if entries come back in tag order, so this walks the
 * tag array once and keeps whichever order is actually on the event.
 */
export function parseDirectEmoji(tags: string[][]): EmojiEntry[] {
  const out: EmojiEntry[] = [];

  for (const tag of tags) {
    if (isCustomEmojiTag(tag)) out.push({ shortcode: tag[1], url: tag[2] });
    else if (isNativeEmojiTag(tag)) out.push({ shortcode: tag[1], native: tag[2] });
  }

  return out;
}

/**
 * Read `a` tags that point at kind:30030 sets.
 *
 * Other `a` tags are ignored rather than assumed: a kind:10030 may reference
 * other kinds, and fetching those would be both wasted and confusing.
 */
export function parseSetCoordinates(tags: string[][]): SetCoordinate[] {
  const out: SetCoordinate[] = [];

  for (const tag of tags) {
    if (tag[0] !== 'a' || typeof tag[1] !== 'string') continue;

    const [kindStr, pubkey, identifier] = tag[1].split(':');
    const kind = Number(kindStr);
    if (kind !== EMOJI_SET_KIND) continue;
    if (!pubkey || pubkey.length !== 64) continue;

    out.push({ kind, pubkey, identifier: identifier ?? '' });
  }

  return out;
}

/**
 * Combine entries, first occurrence winning.
 *
 * Order is deliberate at the call site: the user's own direct tags come before
 * entries from sets they merely subscribe to, so a shortcode they defined
 * themselves is not shadowed by a stranger's set that happens to use the same
 * name.
 */
export function mergeEmoji(...groups: EmojiEntry[][]): EmojiEntry[] {
  const seen = new Set<string>();
  const out: EmojiEntry[] = [];

  for (const group of groups) {
    for (const entry of group) {
      if (seen.has(entry.shortcode)) continue;
      seen.add(entry.shortcode);
      out.push(entry);
    }
  }

  return out;
}

/** True for entries we will render as a glyph. */
export function isRenderable(entry: EmojiEntry): boolean {
  return typeof entry.native === 'string' && entry.native.length > 0;
}

/**
 * The NIP-25 content and tags for reacting with an entry.
 *
 * Unicode reacts with the character itself. A custom emoji reacts with
 * `:shortcode:` plus the emoji tag that tells the receiving client where the
 * image lives -- which is how we stay faithful to the spec while declining to
 * load that image ourselves.
 */
export function reactionPayload(entry: EmojiEntry): { content: string; tags: string[][] } {
  if (entry.native) {
    return { content: entry.native, tags: [] };
  }

  return {
    content: `:${entry.shortcode}:`,
    tags: entry.url ? [['emoji', entry.shortcode, entry.url]] : [],
  };
}
