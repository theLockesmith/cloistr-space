/**
 * @fileoverview The Stash embed's messages are trusted only when they come
 * from Stash's origin AND from the frame Space put on the page, and only in
 * the exact shape the contract names (cloistr-stash docs/embed.md). Anything
 * else is dropped: a message we cannot vouch for is not a message.
 */

import { describe, it, expect } from 'vitest';
import { parseStashEmbedMessage, stashEmbedUrl, type StashEmbedMessage } from './stashEmbed';

const STASH = 'https://stash.cloistr.xyz';
const frame = { name: 'the frame Space rendered' } as unknown as Window;
const otherWindow = { name: 'some other frame' } as unknown as Window;

const SHA = 'a'.repeat(64);
const item = { name: 'report.pdf', sha256: SHA, size: 1234, mimeType: 'application/pdf' };

function msg(data: unknown, over: { origin?: string; source?: unknown } = {}) {
  return {
    origin: over.origin ?? STASH,
    source: ('source' in over ? over.source : frame) as MessageEventSource | null,
    data,
  };
}

const env = (data: Record<string, unknown>) => ({ source: 'cloistr-stash-embed', version: 1, ...data });
const parse = (e: ReturnType<typeof msg>) => parseStashEmbedMessage(e, { stashOrigin: STASH, frame });

describe('stashEmbedUrl', () => {
  it('names the exact parent origin and the mode', () => {
    const url = new URL(stashEmbedUrl({ stashOrigin: STASH, parentOrigin: 'https://space.cloistr.xyz', mode: 'pick' }));
    expect(url.origin).toBe(STASH);
    expect(url.pathname).toBe('/embed/files');
    expect(url.searchParams.get('parent')).toBe('https://space.cloistr.xyz');
    expect(url.searchParams.get('mode')).toBe('pick');
  });

  it('takes the origin of a Stash address that carries a path', () => {
    const url = new URL(stashEmbedUrl({ stashOrigin: `${STASH}/`, parentOrigin: 'https://space.cloistr.xyz', mode: 'browse' }));
    expect(url.href).toBe(`${STASH}/embed/files?parent=https%3A%2F%2Fspace.cloistr.xyz&mode=browse`);
  });
});

describe('parseStashEmbedMessage accepts the four contract messages', () => {
  it.each<[Record<string, unknown>, StashEmbedMessage]>([
    [{ type: 'ready', signedIn: true }, { type: 'ready', signedIn: true }],
    [{ type: 'ready', signedIn: false }, { type: 'ready', signedIn: false }],
    [{ type: 'cancelled' }, { type: 'cancelled' }],
    [{ type: 'resize', height: 480 }, { type: 'resize', height: 480 }],
    [{ type: 'picked', items: [item] }, { type: 'picked', items: [item] }],
    [{ type: 'picked', items: [] }, { type: 'picked', items: [] }],
    [
      { type: 'picked', items: [{ name: 'n', sha256: SHA, size: null, mimeType: null }] },
      { type: 'picked', items: [{ name: 'n', sha256: SHA, size: null, mimeType: null }] },
    ],
  ])('%j', (data, expected) => {
    expect(parse(msg(env(data)))).toEqual(expected);
  });

  it('keeps only the four named fields of a picked item', () => {
    const extra = { ...item, key: 'secret', fileId: 'f1', folderId: 'd1' };
    const out = parse(msg(env({ type: 'picked', items: [extra] })));
    expect(out).toEqual({ type: 'picked', items: [item] });
    expect(Object.keys((out as { items: object[] }).items[0]).sort()).toEqual(['mimeType', 'name', 'sha256', 'size']);
  });
});

describe('parseStashEmbedMessage drops what it cannot vouch for', () => {
  const good = env({ type: 'picked', items: [item] });

  it('a control: the same message from the right place is accepted', () => {
    expect(parse(msg(good))).not.toBeNull();
  });

  it.each([
    ['another site', 'https://evil.example'],
    ['Space itself', 'https://space.cloistr.xyz'],
    ['a Stash look-alike', 'https://stash.cloistr.xyz.evil.example'],
    ['Stash over http', 'http://stash.cloistr.xyz'],
    ['a Stash subdomain', 'https://a.stash.cloistr.xyz'],
    ['an opaque origin', 'null'],
  ])('from the wrong origin: %s', (_label, origin) => {
    expect(parse(msg(good, { origin }))).toBeNull();
  });

  it.each([
    ['another window', otherWindow],
    ['no window', null],
  ])('from the wrong source window: %s', (_label, source) => {
    expect(parse(msg(good, { source }))).toBeNull();
  });

  it('when Space has no frame yet, nothing is accepted', () => {
    expect(parseStashEmbedMessage(msg(good, { source: null }), { stashOrigin: STASH, frame: null })).toBeNull();
  });

  it.each([
    ['version 2', { ...good, version: 2 }],
    ['version "1"', { ...good, version: '1' }],
    ['no version', { source: 'cloistr-stash-embed', type: 'cancelled' }],
  ])('a wrong version: %s', (_label, data) => {
    expect(parse(msg(data))).toBeNull();
  });

  it.each<[string, unknown]>([
    ['not an object', 'picked'],
    ['null', null],
    ['an array', [good]],
    ['the wrong source tag', { ...good, source: 'cloistr-stash' }],
    ['no source tag', { version: 1, type: 'cancelled' }],
    ['an unknown type', env({ type: 'deleted' })],
    ['no type', env({})],
    ['ready without signedIn', env({ type: 'ready' })],
    ['ready with signedIn as a string', env({ type: 'ready', signedIn: 'true' })],
    ['resize without height', env({ type: 'resize' })],
    ['resize with a string height', env({ type: 'resize', height: '480' })],
    ['resize with a negative height', env({ type: 'resize', height: -1 })],
    ['resize with an infinite height', env({ type: 'resize', height: Infinity })],
    ['resize with NaN', env({ type: 'resize', height: NaN })],
    ['picked without items', env({ type: 'picked' })],
    ['picked with items not an array', env({ type: 'picked', items: item })],
    ['an item that is null', env({ type: 'picked', items: [null] })],
    ['an item without a name', env({ type: 'picked', items: [{ ...item, name: undefined }] })],
    ['an item with an empty name', env({ type: 'picked', items: [{ ...item, name: '' }] })],
    ['an item with a numeric name', env({ type: 'picked', items: [{ ...item, name: 7 }] })],
    ['an item without sha256', env({ type: 'picked', items: [{ ...item, sha256: undefined }] })],
    ['an item with a short sha256', env({ type: 'picked', items: [{ ...item, sha256: 'ab' }] })],
    ['an item with a non-hex sha256', env({ type: 'picked', items: [{ ...item, sha256: 'z'.repeat(64) }] })],
    ['an item with upper-case sha256', env({ type: 'picked', items: [{ ...item, sha256: 'A'.repeat(64) }] })],
    ['an item with a string size', env({ type: 'picked', items: [{ ...item, size: '12' }] })],
    ['an item with a negative size', env({ type: 'picked', items: [{ ...item, size: -1 }] })],
    ['an item with a fractional size', env({ type: 'picked', items: [{ ...item, size: 1.5 }] })],
    ['an item with size missing', env({ type: 'picked', items: [{ name: 'n', sha256: SHA, mimeType: null }] })],
    ['an item with a numeric mimeType', env({ type: 'picked', items: [{ ...item, mimeType: 3 }] })],
    ['an item with mimeType missing', env({ type: 'picked', items: [{ name: 'n', sha256: SHA, size: null }] })],
    ['one bad item among good ones', env({ type: 'picked', items: [item, { ...item, sha256: 'x' }] })],
  ])('a malformed payload: %s', (_label, data) => {
    expect(parse(msg(data))).toBeNull();
  });

  it('a getter that throws is dropped, not thrown', () => {
    const hostile = env({ type: 'picked' });
    Object.defineProperty(hostile, 'items', { get() { throw new Error('boom'); }, enumerable: true });
    expect(parse(msg(hostile))).toBeNull();
  });
});
