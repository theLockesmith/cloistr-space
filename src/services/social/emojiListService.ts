/**
 * @fileoverview Edit the operator's own kind:10030 (NIP-51 emoji list).
 *
 * Headless, per the 2026-09-29 directive: every function here takes a
 * SignerInterface + RelayClient (src/services/headless.ts) and nothing from
 * React. useEmojiListEditor.ts supplies NDK-backed adapters for the UI.
 *
 * THE HAZARD THIS FILE EXISTS TO AVOID (CLAUDE.md failure pattern #4):
 * kind:10030 is a replaceable event. Publishing one that carries only the
 * entry just added REPLACES the operator's whole list -- every other direct
 * entry, and every `a` pointer at a kind:30030 set the operator subscribes
 * to, is gone the moment the new event lands. It looks like it worked, right
 * up until the picker loses everything that wasn't the single thing just
 * added.
 *
 * So every edit here is READ (newest kind:10030, by created_at) -> COMPUTE
 * (preserving every tag this module does not manage) -> PUBLISH-WHOLE. A read
 * that fails throws before anything is computed or published -- publishing a
 * fresh list over a read failure is exactly how you'd wipe the rest of it, the
 * same shape as the group-membership hazard this pattern is named after.
 *
 * "Read failed" and "read succeeded, no list exists" are different facts and
 * are kept separate throughout (ListRead.ok vs ListRead.exists): a brand new
 * operator with no kind:10030 yet is not a relay failure, and starting that
 * operator from an empty list is correct. Collapsing the two would mean a
 * flaky relay connection looks identical to "you have no emoji," and the fix
 * for one of those is "try again" while the fix for the other is "add one."
 *
 * TAGS THIS MODULE MANAGES vs TAGS IT LEAVES ALONE:
 *   - `['emoji', shortcode, url]`          -- custom (NIP-30), managed
 *   - `['emoji_native', shortcode, glyph]` -- unicode favourite, managed
 *     (see emojiSets.ts for why this is a second tag rather than reusing
 *     `emoji`)
 *   - everything else -- `a` pointers at kind:30030 sets, a malformed `emoji`
 *     tag missing its url, any tag a future client invents -- is OTHER. It is
 *     never read, never validated, never reordered; it is carried through to
 *     the republished event byte for byte. "Preserve the a pointers" and
 *     "preserve the tags we don't understand" are the same mechanism here on
 *     purpose: this module has no business judging either.
 */

import { signAndPublish, type RelayClient, type SignerInterface } from '../headless';
import { EMOJI_LIST_KIND, EMOJI_NATIVE_TAG, isManagedEmojiTag } from './emojiSets';

/** Only letters, numbers and underscores -- matches the `:shortcode:` convention. */
const SHORTCODE_RE = /^[a-zA-Z0-9_]+$/;

/**
 * A kind:10030 read, with the "did it actually work" question answered
 * SEPARATELY from "what did it find."
 */
export interface ListRead {
  /** False only when the read itself errored or could not reach a relay. */
  ok: boolean;
  /** True when a kind:10030 was found at all (meaningless unless ok is true). */
  exists: boolean;
  /** The newest event's raw tags, or [] when ok && !exists. */
  tags: string[][];
}

export type EditRefusal =
  | 'invalid-shortcode'
  | 'invalid-url'
  | 'invalid-native'
  | 'duplicate-shortcode'
  | 'not-found'
  | 'no-change';

export type EditResult = { ok: true; tags: string[][] } | { ok: false; reason: EditRefusal };

/** Words an operator can act on, for every refusal that is NOT thrown. */
export const REFUSAL_MESSAGE: Record<EditRefusal, string> = {
  'invalid-shortcode': 'Shortcodes may only contain letters, numbers, and underscores.',
  'invalid-url': 'Custom emoji need an image URL starting with https://.',
  'invalid-native': 'Enter the emoji character to add.',
  'duplicate-shortcode': 'That shortcode is already in your list.',
  'not-found': 'That entry is not in your list.',
  'no-change': 'Nothing to change.',
};

/** Read the newest message and bucket its tags. Exported for tests only. */
export function splitManagedTags(tags: string[][]): { entries: string[][]; other: string[][] } {
  const entries: string[][] = [];
  const other: string[][] = [];
  for (const tag of tags) {
    (isManagedEmojiTag(tag) ? entries : other).push(tag);
  }
  return { entries, other };
}

/**
 * Managed entries first (in their edited order), then everything else
 * untouched. The `a` pointers and any tag this module does not recognise are
 * `other` and keep their relative order among themselves.
 */
function rebuild(entries: string[][], other: string[][]): string[][] {
  return [...entries, ...other];
}

function shortcodeOf(tag: string[]): string {
  return tag[1];
}

function hasShortcode(entries: string[][], shortcode: string): boolean {
  return entries.some((tag) => shortcodeOf(tag).toLowerCase() === shortcode.toLowerCase());
}

/**
 * Fetch the operator's own kind:10030, newest by created_at across whatever
 * relays answered.
 *
 * Any number of relays can hand back a stale copy of a replaceable event;
 * "newest" is the only trustworthy answer, never "first" or "last to arrive"
 * -- see the kind:0 fix this repo already shipped for the same reasoning.
 */
export async function readEmojiList(relay: RelayClient, pubkey: string): Promise<ListRead> {
  try {
    const events = await relay.fetch({ kinds: [EMOJI_LIST_KIND], authors: [pubkey] });
    if (events.length === 0) return { ok: true, exists: false, tags: [] };

    let newest = events[0];
    for (const event of events) {
      if ((event.created_at ?? 0) > (newest.created_at ?? 0)) newest = event;
    }
    return { ok: true, exists: true, tags: newest.tags };
  } catch {
    return { ok: false, exists: false, tags: [] };
  }
}

/** The list after adding a unicode favourite. Pure; exported for tests. */
export function listAfterAddUnicode(read: ListRead, native: string, shortcode: string): EditResult {
  const code = shortcode.trim();
  const glyph = native.trim();
  if (!SHORTCODE_RE.test(code)) return { ok: false, reason: 'invalid-shortcode' };
  if (glyph.length === 0) return { ok: false, reason: 'invalid-native' };

  const { entries, other } = splitManagedTags(read.tags);
  if (hasShortcode(entries, code)) return { ok: false, reason: 'duplicate-shortcode' };

  return { ok: true, tags: rebuild([...entries, [EMOJI_NATIVE_TAG, code, glyph]], other) };
}

/** The list after adding a custom (NIP-30) emoji. Pure; exported for tests. */
export function listAfterAddCustom(read: ListRead, shortcode: string, url: string): EditResult {
  const code = shortcode.trim();
  const href = url.trim();
  if (!SHORTCODE_RE.test(code)) return { ok: false, reason: 'invalid-shortcode' };
  // https only -- a bare host, a data: URI, or http:// all fall through to
  // this refusal. The whole point of refusing to FETCH these is privacy; an
  // insecure URL would be a worse version of the same host-disclosure problem
  // this module's sibling (the picker/mirror pipeline) exists to avoid.
  if (!/^https:\/\//i.test(href)) return { ok: false, reason: 'invalid-url' };

  const { entries, other } = splitManagedTags(read.tags);
  if (hasShortcode(entries, code)) return { ok: false, reason: 'duplicate-shortcode' };

  return { ok: true, tags: rebuild([...entries, ['emoji', code, href]], other) };
}

/** The list after removing an entry by shortcode. Pure; exported for tests. */
export function listAfterRemove(read: ListRead, shortcode: string): EditResult {
  const { entries, other } = splitManagedTags(read.tags);
  const next = entries.filter((tag) => shortcodeOf(tag).toLowerCase() !== shortcode.toLowerCase());

  if (next.length === entries.length) return { ok: false, reason: 'not-found' };
  return { ok: true, tags: rebuild(next, other) };
}

/** The list after moving an entry one place up or down. Pure; exported for tests. */
export function listAfterMove(
  read: ListRead,
  shortcode: string,
  direction: 'up' | 'down',
): EditResult {
  const { entries, other } = splitManagedTags(read.tags);
  const index = entries.findIndex((tag) => shortcodeOf(tag).toLowerCase() === shortcode.toLowerCase());
  if (index === -1) return { ok: false, reason: 'not-found' };

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= entries.length) return { ok: false, reason: 'no-change' };

  const next = [...entries];
  [next[index], next[target]] = [next[target], next[index]];
  return { ok: true, tags: rebuild(next, other) };
}

/**
 * READ -> compute -> PUBLISH-WHOLE, shared by every edit below.
 *
 * `compute` never sees a failed read: that case throws here, before compute
 * runs, so there is no path from "the read failed" to "we published anyway."
 */
async function editList(
  signer: SignerInterface,
  relay: RelayClient,
  pubkey: string,
  compute: (read: ListRead) => EditResult,
): Promise<EditResult> {
  const read = await readEmojiList(relay, pubkey);
  if (!read.ok) {
    throw new Error(
      'Could not read your current emoji list, so nothing was changed. ' +
        'Publishing now would have erased the rest of it.',
    );
  }

  const result = compute(read);
  if (!result.ok) return result;

  // signAndPublish -> publishOrThrow: throws when zero relays accept, so a
  // publish that looks like it succeeded but reached nobody is impossible to
  // mistake for a saved change.
  await signAndPublish(signer, relay, { kind: EMOJI_LIST_KIND, content: '', tags: result.tags });
  return result;
}

export async function addUnicodeEmoji(
  signer: SignerInterface,
  relay: RelayClient,
  native: string,
  shortcode: string,
): Promise<EditResult> {
  const pubkey = await signer.getPublicKey();
  return editList(signer, relay, pubkey, (read) => listAfterAddUnicode(read, native, shortcode));
}

export async function addCustomEmoji(
  signer: SignerInterface,
  relay: RelayClient,
  shortcode: string,
  url: string,
): Promise<EditResult> {
  const pubkey = await signer.getPublicKey();
  return editList(signer, relay, pubkey, (read) => listAfterAddCustom(read, shortcode, url));
}

export async function removeEmojiEntry(
  signer: SignerInterface,
  relay: RelayClient,
  shortcode: string,
): Promise<EditResult> {
  const pubkey = await signer.getPublicKey();
  return editList(signer, relay, pubkey, (read) => listAfterRemove(read, shortcode));
}

export async function moveEmojiEntry(
  signer: SignerInterface,
  relay: RelayClient,
  shortcode: string,
  direction: 'up' | 'down',
): Promise<EditResult> {
  const pubkey = await signer.getPublicKey();
  return editList(signer, relay, pubkey, (read) => listAfterMove(read, shortcode, direction));
}
