/**
 * @fileoverview Tests for one-shot subscription handling.
 *
 * Written BEFORE the fix, and the first test is deliberately a demonstration of
 * the BUG rather than of correct behaviour. Two separate defects tonight were
 * diagnosed from NDK's documentation plus a call site without ever being
 * observed running; this converts that into something executed.
 *
 * THE DEFECT: NDK starts a subscription as soon as you call subscribe()
 * (index.d.ts:3373 — "Subscriptions automatically start unless autoStart is set
 * to false"). Code that then attaches .on('event') / .on('eose') has already
 * lost any event delivered in between. For a long-lived streaming subscription
 * that costs nothing, because more events follow. For a one-shot query with
 * closeOnEose that resolves on eose, it is the whole result.
 *
 * Found in four places: useGroupChat and useGroups.startSubscription attach
 * after start and are SAFE (streaming, closeOnEose:false); useGroups
 * .fetchGroupMetadata and the relayPrefs pool adapter attach after start and
 * are BROKEN (one-shot, resolve on eose).
 */

import { describe, it, expect, vi } from 'vitest';
import { subscribeOnce, subscribeStream } from './subscribeOnce';

/**
 * A subscription that delivers immediately on start, the way a relay answering
 * from storage or an NDK cache hit does. This is the timing that loses.
 */
function makeEagerSubscribe(events: unknown[]) {
  return vi.fn((_filters: unknown, _opts?: unknown, handlers?: unknown) => {
    const listeners: Record<string, ((arg?: unknown) => void)[]> = {};

    const sub = {
      on(name: string, fn: (arg?: unknown) => void) {
        (listeners[name] ??= []).push(fn);
      },
      start() {
        // Idempotent, like NDK's — calling start on an already-started
        // subscription must not re-deliver.
      },
      stop: vi.fn(),
    };

    // Deliver SYNCHRONOUSLY, inside subscribe(), before the caller has been
    // handed the subscription and therefore before it can call .on(). This is
    // the timing that matters: NDK delivers to whatever is registered at
    // delivery time, and a handler attached afterwards was never registered.
    //
    // Deferring this to a microtask would let a late .on() win and the fake
    // would quietly stop reproducing the bug — which it did on the first
    // attempt, and the demonstration test caught it.
    const h = handlers as
      | { onEvent?: (e: unknown) => void; onEose?: () => void }
      | undefined;

    for (const e of events) {
      h?.onEvent?.(e);
      listeners.event?.forEach((fn) => fn(e));
    }
    h?.onEose?.();
    listeners.eose?.forEach((fn) => fn());

    return sub;
  });
}

describe('the attach-after-start race', () => {
  it('DEMONSTRATES THE BUG: handlers attached after subscribe miss the delivery', async () => {
    // This is the shape in useGroups.fetchGroupMetadata and the relayPrefs
    // adapter. Kept as an executable record of why the helper exists.
    const subscribe = makeEagerSubscribe([{ id: 'evt1' }]);
    const seen: unknown[] = [];
    let eosed = false;

    const sub = subscribe([{ kinds: [39000] }], { closeOnEose: true }) as {
      on: (n: string, f: (a?: unknown) => void) => void;
      start: () => void;
    };
    // Attaching here is already too late for a synchronous delivery.
    sub.on('event', (e) => seen.push(e));
    sub.on('eose', () => {
      eosed = true;
    });
    sub.start();

    await new Promise((r) => queueMicrotask(() => r(null)));
    await new Promise((r) => queueMicrotask(() => r(null)));

    // The event was delivered and nobody was listening. A one-shot query
    // resolving on eose returns nothing and the caller sees "no such group".
    expect(seen, 'if this now passes, NDK stopped auto-starting').toHaveLength(0);
    expect(eosed).toBe(false);
  });
});

describe('the historical-streaming case, which the old rule called safe', () => {
  /**
   * This is the case that made the previous fix fail, and it is the reason the
   * discriminator in subscribeOnce.ts had to be rewritten.
   *
   * The rule used to be "closeOnEose:false is safe, more events follow". That
   * holds for chat. It does not hold for a subscription whose entire content is
   * events written once and never again — kind:39001 and kind:39002 group
   * membership, written at group creation. The relay sends them in the initial
   * burst right after subscribe(), and then there is nothing else, ever. Missing
   * that burst is exactly as fatal as missing a one-shot reply.
   */
  it('DEMONSTRATES THE BUG: a closeOnEose:false subscription over stored-only events loses everything', async () => {
    const subscribe = makeEagerSubscribe([{ id: 'members-evt' }]);
    const seen: unknown[] = [];

    // Long-lived by closeOnEose, historical by content. The old rule said this
    // shape was fine.
    const sub = subscribe([{ kinds: [39002] }], { closeOnEose: false }) as {
      on: (n: string, f: (a?: unknown) => void) => void;
      start: () => void;
    };
    sub.on('event', (e) => seen.push(e));
    sub.start();

    await new Promise((r) => queueMicrotask(() => r(null)));

    // Nothing follows to recover it. The group's membership is simply gone,
    // and because fetchGroupMetadata is only called from this handler, the
    // downstream metadata query never runs either — which is why fixing that
    // query changed nothing.
    expect(seen, 'stored events were delivered before the handler existed').toHaveLength(0);
  });

  it('subscribeStream receives that same burst', async () => {
    const subscribe = makeEagerSubscribe([{ id: 'members-evt' }]);
    const onEvent = vi.fn();

    subscribeStream(subscribe as never, [{ kinds: [39002] }], { onEvent });

    await new Promise((r) => queueMicrotask(() => r(null)));

    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('subscribeStream leaves closeOnEose to the caller', () => {
    // The distinction that matters is historical-versus-ongoing, not
    // closeOnEose — so the helper must not decide closeOnEose for you the way
    // subscribeOnce does. A group-membership subscription wants to stay open
    // for later joins while still needing the initial burst.
    const subscribe = makeEagerSubscribe([]);
    subscribeStream(subscribe as never, [{ kinds: [9] }], {}, { closeOnEose: false });

    const opts = subscribe.mock.calls[0][1] as { closeOnEose?: boolean };
    expect(opts.closeOnEose).toBe(false);
  });

  it('subscribeStream passes handlers to subscribe, not afterwards', () => {
    const subscribe = makeEagerSubscribe([]);
    subscribeStream(subscribe as never, [{ kinds: [9] }], { onEvent: vi.fn() });

    const third = subscribe.mock.calls[0][2] as { onEvent?: unknown } | undefined;
    expect(third?.onEvent, 'handlers were not passed to subscribe()').toBeTypeOf('function');
  });
});

describe('subscribeOnce', () => {
  it('receives an event delivered during subscribe()', async () => {
    const subscribe = makeEagerSubscribe([{ id: 'evt1' }]);
    const onEvent = vi.fn();

    subscribeOnce(subscribe as never, [{ kinds: [39000] }], { onEvent });

    await new Promise((r) => queueMicrotask(() => r(null)));
    await new Promise((r) => queueMicrotask(() => r(null)));

    // The whole point: handlers are registered as part of subscribing, so
    // there is no window in which delivery can be missed.
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ id: 'evt1' });
  });

  it('receives eose delivered during subscribe()', async () => {
    const subscribe = makeEagerSubscribe([]);
    const onEose = vi.fn();

    subscribeOnce(subscribe as never, [{ kinds: [39000] }], { onEose });

    await new Promise((r) => queueMicrotask(() => r(null)));
    await new Promise((r) => queueMicrotask(() => r(null)));

    // Missing this is what makes a one-shot query hang to its timeout rather
    // than resolve. It is the difference between "no result" and "no result,
    // five seconds later".
    expect(onEose).toHaveBeenCalledTimes(1);
  });

  it('requests closeOnEose, since a one-shot query must not stay open', () => {
    const subscribe = makeEagerSubscribe([]);
    subscribeOnce(subscribe as never, [{ kinds: [39000] }], {});

    const opts = subscribe.mock.calls[0][1] as { closeOnEose?: boolean };
    expect(opts.closeOnEose).toBe(true);
  });

  it('passes handlers to subscribe rather than attaching them afterwards', () => {
    // Pins the mechanism, not just the outcome. If someone later "simplifies"
    // this back to .on() after subscribe, the race returns silently and the
    // behavioural tests above would still pass against a slower fake.
    const subscribe = makeEagerSubscribe([]);
    const onEvent = vi.fn();
    subscribeOnce(subscribe as never, [{ kinds: [1] }], { onEvent });

    const third = subscribe.mock.calls[0][2] as { onEvent?: unknown } | undefined;
    expect(third, 'handlers were not passed to subscribe()').toBeDefined();
    expect(third?.onEvent).toBeTypeOf('function');
  });

  it('returns the subscription so the caller can stop it early', () => {
    const subscribe = makeEagerSubscribe([]);
    const sub = subscribeOnce(subscribe as never, [{ kinds: [1] }], {});
    expect(sub.stop).toBeTypeOf('function');
  });
});
