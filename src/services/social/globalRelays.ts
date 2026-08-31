/**
 * @fileoverview Which relays the global feed should ask.
 *
 * THE BUG THIS FIXES. NDK routes a filter by whether it carries `authors`:
 *
 *   WITH authors    -> that author's write relays, resolved via outbox (dozens)
 *   WITHOUT authors -> ndk.explicitRelayUrls ONLY (for us, exactly one)
 *
 * (calculateRelaySetsFromFilter, ndk dist/index.js:2652-2692.)
 *
 * following and wot carry `authors: following`. global carries none. So global
 * asked ONE relay while following asked dozens, and global was a strict SUBSET
 * of following -- exactly inverted from what "global" means, and precisely the
 * operator's report that their global feed was emptier than their following
 * feed.
 *
 * THE FIX AND ITS TRAP. Passing an explicit relaySet skips that routing. But an
 * explicit relaySet also FREEZES the subscription: NDK's pool monitor
 * recomputes from the filter when a relay connects, and a no-authors filter
 * resolves straight back to explicitRelayUrls, so a relay that connects later
 * is never added. Pinning global would silently undo the late-relay fix that
 * !86 shipped, and would present months later as "global sometimes misses
 * posts" -- indistinguishable from ordinary relay flakiness.
 *
 * So the set is recomputed as relays connect and the subscription re-opens on a
 * WIDER set. That is affordable only because upsertNote makes redelivery free:
 * re-asking relays we already asked returns the same array and costs one render
 * rather than one per note.
 */

/** A relay status as the NDK provider reports it. */
interface RelayStatusLike {
  url: string;
  status: string;
}

/** Connected relay URLs, sorted so the key is stable across map ordering. */
export function connectedRelayUrls(statuses: Iterable<RelayStatusLike>): string[] {
  return Array.from(statuses)
    .filter((s) => s.status === 'connected')
    .map((s) => s.url)
    .sort();
}

/**
 * The widest set of relays seen so far.
 *
 * MONOTONIC ON PURPOSE. A relay that drops and reconnects would otherwise
 * shrink then grow the set and re-subscribe twice for no gain, and a flapping
 * relay would do it repeatedly. Keeping a relay we have lost costs nothing --
 * NDK simply cannot reach it -- while removing one costs a re-subscribe.
 *
 * The consequence is that the number of re-subscribes over a session is bounded
 * by the number of DISTINCT relays ever connected, not by connection events.
 */
export function widenRelays(previous: string[], current: string[]): string[] {
  const union = new Set(previous);
  let grew = false;

  for (const url of current) {
    if (!union.has(url)) {
      union.add(url);
      grew = true;
    }
  }

  // Same array back when nothing was added, so a caller using this as an effect
  // dependency does not re-run on every status change.
  return grew ? Array.from(union).sort() : previous;
}

/**
 * Whether this feed mode needs an explicit relay set.
 *
 * Only global. following and wot carry authors, so NDK's outbox routing already
 * spans the right relays for them -- overriding it would make their feeds WORSE
 * by confining them to relays we happen to be connected to rather than the ones
 * their authors actually write to.
 */
export function needsExplicitRelays(mode: string): boolean {
  return mode === 'global';
}
