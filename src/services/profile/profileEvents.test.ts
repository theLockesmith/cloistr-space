/**
 * @fileoverview Tests for profile event building.
 *
 * The merge tests are the important ones. A kind:0 is a replacement event, so a
 * bug here does not show up as a broken form -- it shows up as a user's display
 * name, avatar and NIP-05 disappearing from every client at once, with the old
 * values unrecoverable unless some relay still holds the prior event.
 */

import { describe, it, expect } from 'vitest';
import {
  mergeProfileContent,
  parseProfileContent,
  buildRelayListTags,
  parseRelayListTags,
  relayListPublishTargets,
} from './profileEvents';

describe('mergeProfileContent', () => {
  it('preserves fields this app does not edit', () => {
    // The whole point. Other clients write keys we have never heard of, and a
    // naive JSON.stringify(formValues) would delete every one of them.
    const existing = JSON.stringify({
      name: 'alice',
      nip05: 'alice@cloistr.xyz',
      lud06: 'lnurl1...',
      damus_donation_v2: 100,
      some_future_field: { nested: true },
    });

    const merged = JSON.parse(mergeProfileContent(existing, { name: 'alice2' }));

    expect(merged.name).toBe('alice2');
    expect(merged.nip05).toBe('alice@cloistr.xyz');
    expect(merged.lud06).toBe('lnurl1...');
    expect(merged.damus_donation_v2).toBe(100);
    expect(merged.some_future_field).toEqual({ nested: true });
  });

  it('leaves untouched editable fields alone when they are undefined', () => {
    const existing = JSON.stringify({ name: 'alice', about: 'hello', picture: 'https://x/y.png' });

    const merged = JSON.parse(mergeProfileContent(existing, { about: 'goodbye' }));

    expect(merged.about).toBe('goodbye');
    expect(merged.name).toBe('alice');
    expect(merged.picture).toBe('https://x/y.png');
  });

  it('writes an empty string through as a deliberate clear', () => {
    const existing = JSON.stringify({ name: 'alice', website: 'https://old.example' });

    const merged = JSON.parse(mergeProfileContent(existing, { website: '' }));

    // Distinct from undefined: the user emptied the input on purpose.
    expect(merged.website).toBe('');
    expect(merged.name).toBe('alice');
  });

  it('creates a profile from nothing when none exists', () => {
    const merged = JSON.parse(mergeProfileContent('', { name: 'alice' }));
    expect(merged).toEqual({ name: 'alice' });
  });

  it('starts a clean object when existing content is not JSON', () => {
    // Some clients have written non-JSON here. Refusing to ever edit the
    // profile again would be worse, and nothing readable is being discarded.
    const merged = JSON.parse(mergeProfileContent('this is not json', { name: 'alice' }));
    expect(merged).toEqual({ name: 'alice' });
  });

  it('starts a clean object when existing content is a JSON array', () => {
    const merged = JSON.parse(mergeProfileContent('[1,2,3]', { name: 'alice' }));
    expect(merged).toEqual({ name: 'alice' });
  });

  it('ignores keys outside the editable set even if passed in', () => {
    const existing = JSON.stringify({ name: 'alice', role: 'admin' });

    const merged = JSON.parse(
      mergeProfileContent(existing, { name: 'bob', role: 'superadmin' } as never)
    );

    // Only the whitelist is written. An unexpected key on the updates object
    // must not become a way to set arbitrary profile content.
    expect(merged.name).toBe('bob');
    expect(merged.role).toBe('admin');
  });
});

describe('parseProfileContent', () => {
  it('extracts the editable fields', () => {
    const content = JSON.stringify({
      name: 'alice',
      display_name: 'Alice',
      about: 'hi',
      nip05: 'alice@cloistr.xyz',
      unrelated: 'ignored',
    });

    expect(parseProfileContent(content)).toEqual({
      name: 'alice',
      display_name: 'Alice',
      about: 'hi',
      nip05: 'alice@cloistr.xyz',
    });
  });

  it('ignores non-string values rather than coercing them', () => {
    // Rendering a number into a text input would let the user "edit" another
    // client's data into a different type on save.
    const content = JSON.stringify({ name: 'alice', about: 42, picture: null });
    expect(parseProfileContent(content)).toEqual({ name: 'alice' });
  });

  it('returns empty for unparseable or empty content', () => {
    expect(parseProfileContent('')).toEqual({});
    expect(parseProfileContent('nope')).toEqual({});
    expect(parseProfileContent('[]')).toEqual({});
  });

  it('round-trips with mergeProfileContent', () => {
    const original = { name: 'alice', about: 'hi', lud16: 'alice@cloistr.xyz' };
    const content = mergeProfileContent('', original);
    expect(parseProfileContent(content)).toEqual(original);
  });
});

describe('buildRelayListTags', () => {
  it('emits a bare r tag for a read+write relay', () => {
    // NIP-65: no marker means both. A marker pair or two tags would be wrong,
    // and some clients only look at tag[2].
    expect(buildRelayListTags([{ url: 'wss://a.com', read: true, write: true }])).toEqual([
      ['r', 'wss://a.com'],
    ]);
  });

  it('emits directional markers for one-way relays', () => {
    expect(
      buildRelayListTags([
        { url: 'wss://r.com', read: true, write: false },
        { url: 'wss://w.com', read: false, write: true },
      ])
    ).toEqual([
      ['r', 'wss://r.com', 'read'],
      ['r', 'wss://w.com', 'write'],
    ]);
  });

  it('drops entries that are neither read nor write', () => {
    // That is a removal expressed through the form, not a roleless relay.
    expect(buildRelayListTags([{ url: 'wss://x.com', read: false, write: false }])).toEqual([]);
  });

  it('drops blank urls and trims whitespace', () => {
    expect(
      buildRelayListTags([
        { url: '   ', read: true, write: true },
        { url: '  wss://a.com  ', read: true, write: true },
      ])
    ).toEqual([['r', 'wss://a.com']]);
  });
});

describe('parseRelayListTags', () => {
  it('treats a missing marker as both directions', () => {
    expect(parseRelayListTags([['r', 'wss://a.com']])).toEqual([
      { url: 'wss://a.com', read: true, write: true },
    ]);
  });

  it('reads directional markers', () => {
    expect(
      parseRelayListTags([
        ['r', 'wss://r.com', 'read'],
        ['r', 'wss://w.com', 'write'],
      ])
    ).toEqual([
      { url: 'wss://r.com', read: true, write: false },
      { url: 'wss://w.com', read: false, write: true },
    ]);
  });

  it('merges duplicate urls into one bidirectional entry', () => {
    // Two rows for one relay would let the user delete one and silently keep
    // the other.
    expect(
      parseRelayListTags([
        ['r', 'wss://a.com', 'read'],
        ['r', 'wss://a.com', 'write'],
      ])
    ).toEqual([{ url: 'wss://a.com', read: true, write: true }]);
  });

  it('treats an unknown marker as both rather than dropping the relay', () => {
    expect(parseRelayListTags([['r', 'wss://a.com', 'sometimes']])).toEqual([
      { url: 'wss://a.com', read: true, write: true },
    ]);
  });

  it('ignores non-r tags and malformed entries', () => {
    expect(
      parseRelayListTags([
        ['p', 'deadbeef'],
        ['r'],
        ['r', ''],
        ['r', 'wss://a.com'],
      ])
    ).toEqual([{ url: 'wss://a.com', read: true, write: true }]);
  });

  it('round-trips with buildRelayListTags', () => {
    const entries = [
      { url: 'wss://both.com', read: true, write: true },
      { url: 'wss://read.com', read: true, write: false },
      { url: 'wss://write.com', read: false, write: true },
    ];
    expect(parseRelayListTags(buildRelayListTags(entries))).toEqual(entries);
  });
});

describe('relayListPublishTargets', () => {
  it('unions current relays with newly declared write relays', () => {
    // The old set so existing followers see the change, the new set so the
    // list is present where the user is moving to.
    const targets = relayListPublishTargets(
      ['wss://old.com'],
      [
        { url: 'wss://new.com', read: true, write: true },
        { url: 'wss://readonly.com', read: true, write: false },
      ]
    );

    expect(targets).toContain('wss://old.com');
    expect(targets).toContain('wss://new.com');
    // Read-only relays are not publish targets.
    expect(targets).not.toContain('wss://readonly.com');
  });

  it('deduplicates when a relay is both current and newly declared', () => {
    const targets = relayListPublishTargets(
      ['wss://a.com'],
      [{ url: 'wss://a.com', read: true, write: true }]
    );
    expect(targets).toEqual(['wss://a.com']);
  });
});
