/**
 * @fileoverview Space's half of the Stash file picker.
 *
 * Stash frames the user's drive at /embed/files on its own origin, so the
 * root, folder and file keys never enter Space. Space receives only the files
 * the user picks, by postMessage. Contract: cloistr-stash docs/embed.md.
 *
 * Space sends the embed nothing; everything it needs is in its URL. A message
 * is trusted only if it comes from Stash's origin AND from the frame Space
 * rendered, carries the contract's source tag and version, and has exactly
 * the shape its type names. Anything else is dropped.
 */

export type StashEmbedMode = 'browse' | 'pick';

/** A picked file. sha256 names the ENCRYPTED blob: it identifies the file, it does not open it. */
export interface StashPickedItem {
  name: string;
  sha256: string;
  size: number | null;
  mimeType: string | null;
}

export type StashEmbedMessage =
  | { type: 'ready'; signedIn: boolean }
  | { type: 'picked'; items: StashPickedItem[] }
  | { type: 'cancelled' }
  | { type: 'resize'; height: number };

const SOURCE_TAG = 'cloistr-stash-embed';
const VERSION = 1;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The embed's address. parentOrigin must be Space's exact origin; Stash refuses anything else. */
export function stashEmbedUrl(opts: { stashOrigin: string; parentOrigin: string; mode: StashEmbedMode }): string {
  const url = new URL('/embed/files', new URL(opts.stashOrigin).origin);
  url.searchParams.set('parent', opts.parentOrigin);
  url.searchParams.set('mode', opts.mode);
  return url.href;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parseItem(raw: unknown): StashPickedItem | null {
  if (!isRecord(raw)) return null;
  const { name, sha256, size, mimeType } = raw;
  if (typeof name !== 'string' || name === '') return null;
  if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) return null;
  if (size !== null && !(typeof size === 'number' && Number.isSafeInteger(size) && size >= 0)) return null;
  if (mimeType !== null && typeof mimeType !== 'string') return null;
  // Only the four named fields; anything else the embed sends is not ours to keep.
  return { name, sha256, size, mimeType };
}

function parseData(data: unknown): StashEmbedMessage | null {
  if (!isRecord(data)) return null;
  if (data.source !== SOURCE_TAG || data.version !== VERSION) return null;

  switch (data.type) {
    case 'ready':
      return typeof data.signedIn === 'boolean' ? { type: 'ready', signedIn: data.signedIn } : null;
    case 'cancelled':
      return { type: 'cancelled' };
    case 'resize':
      return typeof data.height === 'number' && Number.isFinite(data.height) && data.height >= 0
        ? { type: 'resize', height: data.height }
        : null;
    case 'picked': {
      if (!Array.isArray(data.items)) return null;
      const items: StashPickedItem[] = [];
      for (const raw of data.items) {
        const parsed = parseItem(raw);
        // One bad item means the message is not what the contract promised; take none of it.
        if (!parsed) return null;
        items.push(parsed);
      }
      return { type: 'picked', items };
    }
    default:
      return null;
  }
}

/**
 * The message, if it is one Space can vouch for; otherwise null.
 *
 * `frame` is the contentWindow of the iframe Space rendered. With no frame,
 * nothing is accepted.
 */
export function parseStashEmbedMessage(
  event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  opts: { stashOrigin: string; frame: Window | null }
): StashEmbedMessage | null {
  if (!opts.frame || event.source !== opts.frame) return null;
  if (event.origin !== new URL(opts.stashOrigin).origin) return null;
  try {
    return parseData(event.data);
  } catch {
    // A hostile getter on the payload is a malformed message, not a crash.
    return null;
  }
}
