/**
 * @fileoverview Tests for note content parsing.
 *
 * Note content is a plain string authored by a stranger and delivered by a
 * relay -- the most untrusted input in the app. The security cases here are not
 * hypothetical: this is the same class as the malformed `p` tag that crashed
 * the members panel, and as the 46 profiles found carrying `website` values
 * with no URL scheme.
 */

import { describe, it, expect } from 'vitest';
import { parseNoteContent, isSafeUrl, classifyUrl, displayUrl } from './noteContent';

describe('isSafeUrl', () => {
  it('accepts http and https', () => {
    expect(isSafeUrl('https://example.test/a')).toBe(true);
    expect(isSafeUrl('http://example.test/a')).toBe(true);
  });

  it('REJECTS javascript:', () => {
    // The reason nothing here emits HTML. A note author must never be able to
    // put script in an href.
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects data: and vbscript:', () => {
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox')).toBe(false);
  });

  it('rejects schemes nobody thought of', () => {
    // The point of an allowlist. A denylist is a list of attacks you have
    // already heard about.
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeUrl('ftp://example.test')).toBe(false);
    expect(isSafeUrl('chrome://settings')).toBe(false);
  });

  it('rejects an unparseable URL', () => {
    expect(isSafeUrl('https://')).toBe(false);
    expect(isSafeUrl('not a url')).toBe(false);
  });
});

describe('classifyUrl', () => {
  it('recognises images, including with a query string', () => {
    expect(classifyUrl('https://x.test/a.jpg')).toBe('image');
    expect(classifyUrl('https://x.test/a.PNG?w=100')).toBe('image');
    expect(classifyUrl('https://x.test/a.webp#frag')).toBe('image');
  });

  it('recognises video', () => {
    expect(classifyUrl('https://x.test/a.mp4')).toBe('video');
  });

  it('treats anything else as a link', () => {
    expect(classifyUrl('https://x.test/article')).toBe('link');
    // A path segment that merely contains an extension-like string is not one.
    expect(classifyUrl('https://x.test/a.jpg.html')).toBe('link');
  });
});

describe('parseNoteContent', () => {
  it('returns plain text unchanged', () => {
    expect(parseNoteContent('just words')).toEqual([{ type: 'text', value: 'just words' }]);
  });

  it('preserves the text around a link', () => {
    const segments = parseNoteContent('see https://x.test/a now');

    expect(segments).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', href: 'https://x.test/a', label: 'x.test/a' },
      { type: 'text', value: ' now' },
    ]);
  });

  it('renders an image URL as an image', () => {
    expect(parseNoteContent('https://x.test/cat.jpg')).toEqual([
      { type: 'image', src: 'https://x.test/cat.jpg' },
    ]);
  });

  it('does not swallow a trailing full stop into the URL', () => {
    // "see https://x.test/page." should link the page, not a URL ending in a
    // full stop that 404s.
    const segments = parseNoteContent('read https://x.test/page.');

    expect(segments[1]).toEqual({ type: 'link', href: 'https://x.test/page', label: 'x.test/page' });
    expect(segments[2]).toEqual({ type: 'text', value: '.' });
  });

  it('keeps balanced parentheses inside a URL', () => {
    // Wikipedia does this constantly. Trimming blindly would break every one.
    const url = 'https://en.wikipedia.test/wiki/Nostr_(protocol)';
    const segments = parseNoteContent(url);

    expect(segments).toEqual([{ type: 'link', href: url, label: displayUrl(url) }]);
  });

  it('trims an unbalanced closing bracket', () => {
    const segments = parseNoteContent('(see https://x.test/a)');

    expect(segments[1]).toMatchObject({ type: 'link', href: 'https://x.test/a' });
  });

  it('drops an unsafe URL rather than linking it', () => {
    // It stays as TEXT. Silently removing it would hide what the author wrote.
    const segments = parseNoteContent('click javascript:alert(1) here');

    expect(segments.every((s) => s.type === 'text')).toBe(true);
  });

  it('recognises hashtags', () => {
    const segments = parseNoteContent('about #nostr today');

    expect(segments[1]).toEqual({ type: 'hashtag', tag: 'nostr' });
  });

  it('does not treat a mid-word hash as a tag', () => {
    // "C#" and "issue#3" are not hashtags.
    expect(parseNoteContent('I write C#').every((s) => s.type === 'text')).toBe(true);
  });

  it('recognises nostr entities with and without the prefix', () => {
    const npub = 'npub1' + 'q'.repeat(58);
    expect(parseNoteContent(`hi nostr:${npub}`)[1]).toEqual({ type: 'entity', id: npub });
    expect(parseNoteContent(`hi ${npub}`)[1]).toEqual({ type: 'entity', id: npub });
  });

  it('does not run an entity match past its end into prose', () => {
    // Bech32 excludes b, i, o and 1 in the data part, so a following word
    // cannot be absorbed.
    const npub = 'npub1' + 'q'.repeat(58);
    const segments = parseNoteContent(`${npub} said hello`);

    expect(segments[0]).toEqual({ type: 'entity', id: npub });
    expect(segments[1]).toEqual({ type: 'text', value: ' said hello' });
  });

  it('does not tear a URL apart at something inside it that looks like a tag', () => {
    // The earliest-then-longest rule. Without it the URL would be split and
    // both halves rendered broken.
    const segments = parseNoteContent('https://x.test/a#section');

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: 'link' });
  });

  it('handles several things in one note', () => {
    const segments = parseNoteContent('pic https://x.test/a.png and #tag and https://y.test/b');

    expect(segments.map((s) => s.type)).toEqual(['text', 'image', 'text', 'hashtag', 'text', 'link']);
  });

  it('preserves newlines as text', () => {
    // Line breaks are content. The renderer applies whitespace-pre-wrap.
    expect(parseNoteContent('one\n\ntwo')).toEqual([{ type: 'text', value: 'one\n\ntwo' }]);
  });

  it('returns nothing for empty content', () => {
    expect(parseNoteContent('')).toEqual([]);
  });

  it('survives content that is only punctuation', () => {
    expect(() => parseNoteContent('!!!???...')).not.toThrow();
  });
});

describe('displayUrl', () => {
  it('drops the scheme but keeps the host', () => {
    // The host is the part a reader needs to judge whether to click.
    expect(displayUrl('https://example.test/path')).toBe('example.test/path');
  });

  it('truncates a very long URL', () => {
    const long = `https://example.test/${'a'.repeat(200)}`;
    expect(displayUrl(long).length).toBeLessThan(60);
  });
});
