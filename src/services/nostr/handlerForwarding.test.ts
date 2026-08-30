/**
 * @fileoverview Pins that subscription handlers survive the whole call chain.
 *
 * This exists because of the argument that nearly nullified an entire round of
 * fixes. Every hook in the app subscribes through NdkProvider's context
 * callback, which was written as
 *
 *   (filters, opts) => service.subscribe(filters, opts)
 *
 * and silently discarded the third argument. Handlers registered at subscribe
 * time were therefore thrown away before reaching NDK — at every call site
 * simultaneously, while each call site read as perfectly correct.
 *
 * TypeScript does not catch this: a callback may legally declare fewer
 * parameters than its type allows, so the compiler was happy. The symptom would
 * have been identical to the bug being fixed, which is how a correct fix comes
 * to look like a failed one.
 *
 * Deliberately a separate file rather than an addition to ndk.test.ts, which is
 * in vitest's exclude list and does not run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ndkSubscribe = vi.fn();

vi.mock('@nostr-dev-kit/ndk', () => {
  const MockNDK = vi.fn().mockImplementation(() => ({
    pool: { on: vi.fn(), relays: new Map() },
    connect: vi.fn().mockResolvedValue(undefined),
    signer: undefined,
    subscribe: ndkSubscribe,
    fetchEvents: vi.fn().mockResolvedValue(new Set()),
  }));

  return {
    default: MockNDK,
    NDKEvent: vi.fn(),
    NDKRelaySet: vi.fn(),
    NDKUser: vi.fn(),
    NDKRelay: vi.fn(),
    normalizeRelayUrl: (u: string) => u,
  };
});

const { NdkService } = await import('./ndk');

describe('subscribe handler forwarding', () => {
  beforeEach(() => ndkSubscribe.mockClear());

  it('forwards handlers through NdkService to NDK', () => {
    const service = new NdkService({ explicitRelayUrls: ['wss://relay.test'] });
    const handlers = { onEvent: vi.fn(), onEose: vi.fn() };

    service.subscribe([{ kinds: [1] }], { closeOnEose: true }, handlers);

    // The third argument is the whole point. Losing it here reintroduces the
    // auto-start race everywhere at once.
    expect(ndkSubscribe).toHaveBeenCalledWith([{ kinds: [1] }], { closeOnEose: true }, handlers);
  });

  it('omits the handlers argument entirely when none are given', () => {
    // NDK's third positional also accepts a relay set or an autoStart boolean,
    // so passing an explicit undefined is not equivalent to not passing it.
    const service = new NdkService({ explicitRelayUrls: ['wss://relay.test'] });

    service.subscribe([{ kinds: [1] }], { closeOnEose: false });

    expect(ndkSubscribe).toHaveBeenCalledWith([{ kinds: [1] }], { closeOnEose: false });
    expect(ndkSubscribe.mock.calls[0]).toHaveLength(2);
  });

  it('normalizes a single filter object into an array', () => {
    const service = new NdkService({ explicitRelayUrls: ['wss://relay.test'] });
    const handlers = { onEvent: vi.fn() };

    service.subscribe({ kinds: [1] }, undefined, handlers);

    expect(ndkSubscribe).toHaveBeenCalledWith([{ kinds: [1] }], undefined, handlers);
  });
});
