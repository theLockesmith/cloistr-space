/**
 * Every publish is bounded: a relay or signer that never answers must not
 * leave the caller waiting forever.
 *
 * NDK limits each relay to 2.5s, but two steps run before any relay is
 * contacted and have no limit: the outbox lookup of the author's relay list,
 * and signing an event that arrives unsigned (a NIP-46 round trip). The two
 * choke points every publish passes through -- publishOrThrow for headless
 * callers and NdkService.publish for the UI -- carry the bound, matching
 * @cloistr/collab-common 0.5.0 (15s, PublishTimeoutError).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { Event } from 'nostr-tools';
import { publishOrThrow, PublishTimeoutError, PUBLISH_TIMEOUT_MS, type RelayClient } from './headless';

const { NdkService } = await import('./nostr/ndk');

const never = () => new Promise<never>(() => {});

const event = { id: 'e'.repeat(64) } as Event;

afterEach(() => {
  vi.useRealTimers();
});

describe('publish timeout', () => {
  it('is 15 seconds, matching collab-common', () => {
    expect(PUBLISH_TIMEOUT_MS).toBe(15_000);
  });

  it('publishOrThrow rejects with PublishTimeoutError when the relay never answers', async () => {
    vi.useFakeTimers();
    const relay: RelayClient = { publish: never, fetch: async () => [] };

    const result = publishOrThrow(relay, event);
    const assertion = expect(result).rejects.toBeInstanceOf(PublishTimeoutError);
    await vi.advanceTimersByTimeAsync(PUBLISH_TIMEOUT_MS);
    await assertion;
  });

  it('does not time out a publish that answers before the limit', async () => {
    vi.useFakeTimers();
    const relay: RelayClient = {
      publish: () => new Promise((resolve) => setTimeout(() => resolve(2), PUBLISH_TIMEOUT_MS - 1)),
      fetch: async () => [],
    };

    const result = publishOrThrow(relay, event);
    await vi.advanceTimersByTimeAsync(PUBLISH_TIMEOUT_MS - 1);
    await expect(result).resolves.toEqual({ acceptedBy: 2, eventId: event.id });
  });

  it('says the event may still arrive, because a timeout is not a refusal', async () => {
    vi.useFakeTimers();
    const relay: RelayClient = { publish: never, fetch: async () => [] };

    const result = publishOrThrow(relay, event);
    const assertion = expect(result).rejects.toThrow(/may still arrive/);
    await vi.advanceTimersByTimeAsync(PUBLISH_TIMEOUT_MS);
    await assertion;
  });

  it('NdkService.publish rejects with PublishTimeoutError when NDK never settles', async () => {
    vi.useFakeTimers();
    const service = new NdkService({ explicitRelayUrls: ['wss://relay.test'] });
    const ndkEvent = { publish: vi.fn(never) } as unknown as NDKEvent;

    const result = service.publish(ndkEvent);
    const assertion = expect(result).rejects.toBeInstanceOf(PublishTimeoutError);
    await vi.advanceTimersByTimeAsync(PUBLISH_TIMEOUT_MS);
    await assertion;
  });
});
