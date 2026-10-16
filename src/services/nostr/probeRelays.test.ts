/**
 * @fileoverview probeRelay: one relay, one answer, and "answered" only on that
 * relay's own EOSE.
 *
 * NDK emits 'eose' for a subscription as a whole, and can emit it without any
 * relay having answered (a cache, or its own timers when relays are slow). For
 * a decision that is only safe if THIS relay said "nothing", the relay's URL
 * has to be in eosesSeen when eose fires.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { probeRelay, type ProbeSubscribe } from './probeRelays';

type Handlers = { onEvent?: (e: { rawEvent: () => unknown }) => void; onEose?: () => void };

/** A fake NDK subscribe that lets the test drive one subscription. */
function fakeSubscribe() {
  const state = {
    handlers: {} as Handlers,
    closedCb: undefined as undefined | ((relay: { url: string }, reason: string) => void),
    eosesSeen: new Set<{ url: string }>(),
    stopped: false,
    opts: undefined as unknown,
  };
  const subscribe: ProbeSubscribe = (_filters, opts, handlers) => {
    state.opts = opts;
    state.handlers = handlers as Handlers;
    return {
      eosesSeen: state.eosesSeen,
      on: (_evt: 'closed', cb: (relay: { url: string }, reason: string) => void) => {
        state.closedCb = cb;
      },
      stop: () => {
        state.stopped = true;
      },
    };
  };
  return { subscribe, state };
}

const raw = (id: string) => ({ rawEvent: () => ({ id, kind: 39000 }) });

afterEach(() => vi.useRealTimers());

describe('probeRelay', () => {
  it("answers with the relay's events once that relay sends EOSE", async () => {
    const { subscribe, state } = fakeSubscribe();
    const p = probeRelay(subscribe, 'wss://a.example', { kinds: [39000] }, 1000);
    state.handlers.onEvent?.(raw('1'));
    state.eosesSeen.add({ url: 'wss://a.example/' });
    state.handlers.onEose?.();
    expect(await p).toEqual({ url: 'wss://a.example', status: 'answered', events: [{ id: '1', kind: 39000 }] });
    expect(state.stopped).toBe(true);
  });

  it('an eose with no EOSE from this relay is a failure, not an empty answer', async () => {
    const { subscribe, state } = fakeSubscribe();
    const p = probeRelay(subscribe, 'wss://a.example', { kinds: [39000] }, 1000);
    state.handlers.onEose?.();
    expect((await p).status).toBe('failed');
  });

  it('a relay that never answers fails at the timeout', async () => {
    vi.useFakeTimers();
    const { subscribe, state } = fakeSubscribe();
    const p = probeRelay(subscribe, 'wss://a.example', { kinds: [39000] }, 1000);
    vi.advanceTimersByTime(1000);
    expect(await p).toEqual({ url: 'wss://a.example', status: 'failed', reason: 'No answer within 1s' });
    expect(state.stopped).toBe(true);
  });

  it('a CLOSED from the relay is a failure', async () => {
    const { subscribe, state } = fakeSubscribe();
    const p = probeRelay(subscribe, 'wss://a.example', { kinds: [39000] }, 1000);
    state.closedCb?.({ url: 'wss://a.example/' }, 'auth-required: sign in');
    expect(await p).toEqual({ url: 'wss://a.example', status: 'failed', reason: 'auth-required: sign in' });
  });

  it('asks only this relay, closes on EOSE, and is never grouped with other queries', () => {
    const { subscribe, state } = fakeSubscribe();
    void probeRelay(subscribe, 'wss://a.example', { kinds: [39000] }, 1000);
    expect(state.opts).toMatchObject({ closeOnEose: true, groupable: false, relayUrls: ['wss://a.example'] });
  });
});
