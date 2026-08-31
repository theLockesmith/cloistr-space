/**
 * @fileoverview Parse note content into renderable segments.
 *
 * Note content is a plain string authored by a stranger and delivered by a
 * relay. It is the most untrusted input in the app, so this module's job is to
 * decide what each fragment IS, and to refuse anything it cannot vouch for.
 *
 * WHY A PARSER RATHER THAN dangerouslySetInnerHTML: the obvious way to make
 * links clickable is to build an HTML string. That hands script execution to
 * whoever wrote the note. Nothing here emits HTML; it emits a typed list that
 * React renders as elements, so a malicious note is at worst ugly.
 *
 * SCHEME ALLOWLIST, NOT DENYLIST. Only http and https survive. `javascript:`,
 * `data:` and `vbscript:` are the obvious attacks, but the reason to allowlist
 * is the ones nobody has thought of -- a denylist is a list of attacks you have
 * already heard about.
 */

const SCHEME_OK = /^https?:\/\//i;

/** Extensions we will render inline. */
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i;

/**
 * NIP-19 entities, with or without a `nostr:` prefix.
 *
 * Bech32 is [023456789acdefghjklmnpqrstuvwxyz] -- no b, i, o or 1 in the data
 * part -- so this cannot run past the end of an identifier into ordinary prose.
 */
const NOSTR_ENTITY = /(?:nostr:)?((?:npub|nprofile|note|nevent|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi;

/** A URL, stopping before trailing punctuation that is almost certainly prose. */
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

/** `#tag`, not preceded by a word character so `C#` and `#1` behave. */
const HASHTAG = /(^|\s)#([\p{L}\p{N}_-]{1,64})/gu;

export type Segment =
  | { type: 'text'; value: string }
  | { type: 'link'; href: string; label: string }
  | { type: 'image'; src: string }
  | { type: 'video'; src: string }
  | { type: 'entity'; id: string }
  | { type: 'hashtag'; tag: string };

interface Match {
  start: number;
  end: number;
  segment: Segment;
}

/** True for a URL we are willing to put in an href or src. */
export function isSafeUrl(url: string): boolean {
  if (!SCHEME_OK.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    // An unparseable URL is not one we should hand to the browser.
    return false;
  }
}

/** Classify a safe URL by what it points at. */
export function classifyUrl(url: string): 'image' | 'video' | 'link' {
  if (IMAGE_EXT.test(url)) return 'image';
  if (VIDEO_EXT.test(url)) return 'video';
  return 'link';
}

/**
 * Trailing punctuation is almost always prose, not part of the URL.
 *
 * "see https://x.test/page." should link the page, not a URL ending in a full
 * stop. Closing brackets are only trimmed when unbalanced, so a URL that
 * legitimately contains parentheses -- Wikipedia does this constantly --
 * survives intact.
 */
function trimTrailingPunctuation(url: string): string {
  let end = url.length;

  while (end > 0) {
    const ch = url[end - 1];
    if ('.,;:!?'.includes(ch)) {
      end--;
      continue;
    }
    if (ch === ')' || ch === ']') {
      const open = ch === ')' ? '(' : '[';
      const slice = url.slice(0, end);
      const opens = slice.split(open).length - 1;
      const closes = slice.split(ch).length - 1;
      if (closes > opens) {
        end--;
        continue;
      }
    }
    break;
  }

  return url.slice(0, end);
}

/** Shorten a URL for display without hiding where it goes. */
export function displayUrl(url: string, max = 48): string {
  const stripped = url.replace(/^https?:\/\//i, '');
  return stripped.length <= max ? stripped : `${stripped.slice(0, max)}…`;
}

/**
 * Split note content into segments, in order.
 *
 * Overlapping matches are resolved by taking the EARLIEST, then the LONGEST.
 * Without that, a URL containing something that looks like a hashtag would be
 * torn in half and rendered as two broken pieces.
 */
export function parseNoteContent(content: string): Segment[] {
  if (!content) return [];

  const matches: Match[] = [];

  for (const m of content.matchAll(URL_PATTERN)) {
    const raw = trimTrailingPunctuation(m[0]);
    if (!isSafeUrl(raw)) continue;

    const kind = classifyUrl(raw);
    matches.push({
      start: m.index,
      end: m.index + raw.length,
      segment:
        kind === 'image'
          ? { type: 'image', src: raw }
          : kind === 'video'
            ? { type: 'video', src: raw }
            : { type: 'link', href: raw, label: displayUrl(raw) },
    });
  }

  for (const m of content.matchAll(NOSTR_ENTITY)) {
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      segment: { type: 'entity', id: m[1] },
    });
  }

  for (const m of content.matchAll(HASHTAG)) {
    // m[1] is the leading space, which belongs to the surrounding text.
    const start = m.index + m[1].length;
    matches.push({
      start,
      end: start + m[2].length + 1,
      segment: { type: 'hashtag', tag: m[2] },
    });
  }

  matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  const segments: Segment[] = [];
  let cursor = 0;

  for (const match of matches) {
    // Dropped rather than nested: a match inside another match has already been
    // rendered as part of it.
    if (match.start < cursor) continue;

    if (match.start > cursor) {
      segments.push({ type: 'text', value: content.slice(cursor, match.start) });
    }
    segments.push(match.segment);
    cursor = match.end;
  }

  if (cursor < content.length) {
    segments.push({ type: 'text', value: content.slice(cursor) });
  }

  return segments;
}

/**
 * Return the href of the first non-media link segment in the content, or null.
 *
 * Used by the note card to render a link preview without re-parsing the content
 * a second time in the component. Only link-type segments are returned; image
 * and video segments are rendered inline by the Media block and should not get
 * a duplicate card.
 */
export function firstLinkUrl(content: string): string | null {
  const segments = parseNoteContent(content);
  for (const s of segments) {
    if (s.type === 'link') return s.href;
  }
  return null;
}
