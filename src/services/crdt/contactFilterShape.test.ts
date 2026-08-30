/**
 * @fileoverview The contact-list filter must never carry `ids`.
 *
 * This looks like a test about nothing. It guards a destructive path.
 *
 * NDK short-circuits a subscription when it believes the cache has already
 * answered it in full. The check is `queryFullyFilled` (ndk dist/index.js:8810),
 * and it can only return true when the filter contains `ids` -- an id-based
 * query is the one case where the cache can know it has everything, because
 * the caller named exactly what it wanted. When it returns true, `start()`
 * emits eose and NEVER QUERIES RELAYS (index.js:9145-9152).
 *
 * Our contact filter is authors+kind+#d, so `queryFullyFilled` is always false,
 * relays are always consulted, and `remoteEntriesFound` reflects cache UNION
 * relays. That is load-bearing:
 *
 *   contactsSync.sync() PUBLISHES when it finds no remote entries.
 *
 * So a filter that skipped relays would report "no contacts exist" for a user
 * whose contacts merely were not in the local cache, and we would publish an
 * empty list over a populated one. That is not hypothetical -- it is what
 * happened to the operator on 2026-08-24, when a tagless kind:33000 superseded
 * a populated one from 2026-08-02 (the emptiness guard in publishContacts is
 * the other half of the fix).
 *
 * Adding `ids` here would be a natural-looking optimisation -- you know the
 * event id, so you ask for it directly -- and it would silently re-arm that
 * path. Hence this test, and hence the comment: the next person needs the
 * reason, not just the assertion.
 */

import { describe, it, expect } from 'vitest';
import { getNip0aFilter } from './nip0a';

const PUBKEY = 'a'.repeat(64);

describe('getNip0aFilter', () => {
  it('does not carry ids, so NDK can never treat the cache as authoritative', () => {
    const filter = getNip0aFilter(PUBKEY);

    expect(
      'ids' in filter,
      'Adding `ids` lets queryFullyFilled short-circuit the relay query, which ' +
        'makes an uncached list indistinguishable from an empty one -- and sync() ' +
        'publishes an empty list when it sees no remote entries.'
    ).toBe(false);
  });

  it('still selects the right event without ids', () => {
    // The property above is only worth having if the filter it constrains
    // actually works. Otherwise this test passes on a filter that matches
    // nothing, which is its own version of the same bug.
    const filter = getNip0aFilter(PUBKEY);

    expect(filter.kinds).toEqual([33000]);
    expect(filter.authors).toEqual([PUBKEY]);
    expect(filter['#d']).toEqual(['contacts']);
  });
});
