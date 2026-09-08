/**
 * @fileoverview Tests for NdkService.publish error unwrapping.
 *
 * NDKPublishError.message is always the generic "Not enough relays received
 * the event", even when the relay sent a specific reason. The publish helper
 * in ndk.ts unwraps the relay-specific error so callers see it in .message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NDKPublishError, NDKEvent, type NDKRelay } from '@nostr-dev-kit/ndk';

// ---------------------------------------------------------------------------
// We test the unwrap logic in isolation by constructing an NdkService and
// calling publish with a mock event whose .publish throws NDKPublishError.
// ---------------------------------------------------------------------------

// Dynamic import to get the class after the module is loaded.
const { NdkService } = await import('./ndk');

describe('NdkService.publish error unwrapping', () => {
  let service: InstanceType<typeof NdkService>;

  beforeEach(() => {
    service = new NdkService({
      explicitRelayUrls: ['wss://relay.test'],
    });
  });

  it('surfaces the relay-specific reason instead of the generic NDK message', async () => {
    const fakeRelay = { url: 'wss://relay.cloistr.xyz' } as NDKRelay;
    const relayError = new Error('restricted: your pubkey is not on the whitelist');
    const errors = new Map<NDKRelay, Error>([[fakeRelay, relayError]]);
    const publishError = new NDKPublishError(
      'Not enough relays received the event',
      errors,
      new Set(),
    );

    const mockEvent = {
      publish: vi.fn().mockRejectedValue(publishError),
    } as unknown as NDKEvent;

    await expect(service.publish(mockEvent)).rejects.toThrow(
      'restricted: your pubkey is not on the whitelist'
    );
  });

  it('deduplicates identical rejection reasons from multiple relays', async () => {
    const relay1 = { url: 'wss://relay1.test' } as NDKRelay;
    const relay2 = { url: 'wss://relay2.test' } as NDKRelay;
    const reason = 'restricted: not whitelisted';
    const errors = new Map<NDKRelay, Error>([
      [relay1, new Error(reason)],
      [relay2, new Error(reason)],
    ]);
    const publishError = new NDKPublishError(
      'Not enough relays received the event',
      errors,
      new Set(),
    );

    const mockEvent = {
      publish: vi.fn().mockRejectedValue(publishError),
    } as unknown as NDKEvent;

    await expect(service.publish(mockEvent)).rejects.toThrow(reason);

    // The message should contain the reason exactly once, not twice.
    try {
      await service.publish(mockEvent);
    } catch (err) {
      expect((err as Error).message).toBe(reason);
    }
  });

  it('joins different reasons from different relays with semicolons', async () => {
    const relay1 = { url: 'wss://relay1.test' } as NDKRelay;
    const relay2 = { url: 'wss://relay2.test' } as NDKRelay;
    const errors = new Map<NDKRelay, Error>([
      [relay1, new Error('restricted: not whitelisted')],
      [relay2, new Error('rate limited')],
    ]);
    const publishError = new NDKPublishError(
      'Not enough relays received the event',
      errors,
      new Set(),
    );

    const mockEvent = {
      publish: vi.fn().mockRejectedValue(publishError),
    } as unknown as NDKEvent;

    try {
      await service.publish(mockEvent);
      expect.unreachable('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('restricted: not whitelisted');
      expect(msg).toContain('rate limited');
      // Original error preserved as cause for debugging.
      expect((err as Error).cause).toBe(publishError);
    }
  });

  it('passes through non-NDKPublishError errors unchanged', async () => {
    const genericError = new Error('network timeout');
    const mockEvent = {
      publish: vi.fn().mockRejectedValue(genericError),
    } as unknown as NDKEvent;

    await expect(service.publish(mockEvent)).rejects.toThrow('network timeout');
    await expect(service.publish(mockEvent)).rejects.toBe(genericError);
  });

  it('passes through NDKPublishError with empty errors map unchanged', async () => {
    const publishError = new NDKPublishError(
      'Not enough relays received the event',
      new Map(),
      new Set(),
    );

    const mockEvent = {
      publish: vi.fn().mockRejectedValue(publishError),
    } as unknown as NDKEvent;

    await expect(service.publish(mockEvent)).rejects.toBe(publishError);
  });

  it('returns successfully when publish succeeds', async () => {
    const fakeRelay = { url: 'wss://relay.test' } as NDKRelay;
    const mockEvent = {
      publish: vi.fn().mockResolvedValue(new Set([fakeRelay])),
    } as unknown as NDKEvent;

    const result = await service.publish(mockEvent);
    expect(result.size).toBe(1);
  });
});
