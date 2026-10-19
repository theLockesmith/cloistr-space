/**
 * readFromOwnRelays must report how many relays actually answered, so that
 * "nobody answered" is never mistaken for "this user has no event".
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NdkService, OWN_RELAY_READ_TIMEOUT_MS } from './ndk';

type Handlers = { onEvent: (e: { id: string }) => void; onEose: (s: { eosesSeen: Set<unknown> }) => void };

function serviceWith(subscribe: (handlers: Handlers) => { stop: () => void }) {
  const service = new NdkService({ explicitRelayUrls: ['wss://relay.test'] });
  const ndk = service.getNdk() as unknown as { subscribe: unknown };
  ndk.subscribe = vi.fn((_f: unknown, _o: unknown, handlers: Handlers) => subscribe(handlers));
  return service;
}

afterEach(() => vi.useRealTimers());

describe('NdkService.readFromOwnRelays', () => {
  it('reports the relays that sent end-of-results', async () => {
    const service = serviceWith((h) => {
      queueMicrotask(() => {
        h.onEvent({ id: 'x' });
        h.onEose({ eosesSeen: new Set(['r1', 'r2']) });
      });
      return { stop: vi.fn() };
    });
    const result = await service.readFromOwnRelays({ kinds: [33000] } as never);
    expect(result.answeredBy).toBe(2);
    expect(result.events).toHaveLength(1);
  });

  it('reports zero when the query ended with no relay answering', async () => {
    const service = serviceWith((h) => {
      queueMicrotask(() => h.onEose({ eosesSeen: new Set() }));
      return { stop: vi.fn() };
    });
    const result = await service.readFromOwnRelays({ kinds: [33000] } as never);
    expect(result).toEqual({ events: [], answeredBy: 0 });
  });

  it('rejects when nothing settles in time', async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const service = serviceWith(() => ({ stop }));
    const result = service.readFromOwnRelays({ kinds: [33000] } as never);
    const assertion = expect(result).rejects.toThrow(/None of your relays answered/);
    await vi.advanceTimersByTimeAsync(OWN_RELAY_READ_TIMEOUT_MS);
    await assertion;
    expect(stop).toHaveBeenCalled();
  });
});
