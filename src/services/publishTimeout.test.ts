/**
 * Every relay publish is bounded: a relay, or NDK's outbox lookup of the
 * author's relay list, that never answers must not leave the caller waiting
 * forever.
 *
 * NDK limits each relay to 2.5s, but the outbox lookup runs before any relay
 * is contacted and has no limit. The two choke points every publish passes
 * through -- publishOrThrow for headless callers and NdkService.publish for
 * the UI -- carry the bound, matching @cloistr/collab-common 0.5.0 (15s,
 * PublishTimeoutError).
 *
 * Signing is NOT bounded here. Every caller signs before publishing
 * (signAndPublish, makeNdkSigner), outside this window, and a person
 * approving on a remote signer can legitimately take longer than 15s.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { Event } from 'nostr-tools';
import {
  publishOrThrow,
  withPublishTimeout,
  PublishTimeoutError,
  PUBLISH_TIMEOUT_MS,
  type RelayClient,
} from './headless';

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

  it('a publish that fails after its timeout is not an unhandled rejection', async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      let failLate!: (err: Error) => void;
      const work = new Promise<number>((_, reject) => {
        failLate = reject;
      });

      const result = withPublishTimeout(work);
      const assertion = expect(result).rejects.toBeInstanceOf(PublishTimeoutError);
      await vi.advanceTimersByTimeAsync(PUBLISH_TIMEOUT_MS);
      await assertion;

      failLate(new Error('Not enough relays received the event'));
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
