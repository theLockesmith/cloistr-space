/**
 * @fileoverview Tests for NDK service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NdkService, SignerAdapter } from './ndk';
import type { SignerInterface } from '@cloistr/collab-common/auth';

// Mock NDK to avoid actual network connections in tests
vi.mock('@nostr-dev-kit/ndk', () => {
  const mockPool = {
    on: vi.fn(),
    relays: new Map(),
  };

  const MockNDK = vi.fn().mockImplementation(() => ({
    pool: mockPool,
    connect: vi.fn().mockResolvedValue(undefined),
    signer: undefined,
    subscribe: vi.fn(),
    fetchEvents: vi.fn().mockResolvedValue(new Set()),
  }));

  const MockNDKUser = vi.fn().mockImplementation(({ pubkey }) => ({
    pubkey,
  }));

  const MockNDKEvent = vi.fn().mockImplementation(() => ({
    kind: 1,
    content: '',
    tags: [],
    pubkey: '',
    created_at: 0,
    publish: vi.fn().mockResolvedValue(new Set()),
  }));

  return {
    default: MockNDK,
    NDKUser: MockNDKUser,
    NDKEvent: MockNDKEvent,
    NDKRelaySet: vi.fn(),
  };
});

describe('NdkService', () => {
  let service: NdkService;

  beforeEach(() => {
    service = new NdkService({
      explicitRelayUrls: ['wss://test.relay'],
      autoConnect: false,
    });
  });

  afterEach(() => {
    service.disconnect();
  });

  it('initializes with disconnected relay status', () => {
    const statuses = service.getRelayStatuses();
    expect(statuses.size).toBe(1);
    expect(statuses.get('wss://test.relay')?.status).toBe('disconnected');
  });

  it('reports no connection when disconnected', () => {
    expect(service.hasConnection()).toBe(false);
  });

  it('notifies listeners on status change', () => {
    const listener = vi.fn();
    const unsubscribe = service.onStatusChange(listener);

    // Should be called immediately with current status
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('creates NDK events', () => {
    const event = service.createEvent();
    expect(event).toBeDefined();
  });

  it('gets NDK instance', () => {
    const ndk = service.getNdk();
    expect(ndk).toBeDefined();
  });
});

describe('SignerAdapter', () => {
  const mockSigner: SignerInterface = {
    getPublicKey: vi.fn().mockResolvedValue('abc123pubkey'),
    signEvent: vi.fn().mockResolvedValue({ sig: 'signature123' }),
    encrypt: vi.fn().mockResolvedValue('encrypted'),
    decrypt: vi.fn().mockResolvedValue('decrypted'),
  };

  let adapter: SignerAdapter;

  beforeEach(() => {
    adapter = new SignerAdapter(mockSigner);
    vi.clearAllMocks();
  });

  it('throws when accessing pubkey before ready', () => {
    expect(() => adapter.pubkey).toThrow('Signer not ready');
  });

  it('throws when accessing userSync before ready', () => {
    expect(() => adapter.userSync).toThrow('Signer not ready');
  });

  it('resolves user after blockUntilReady', async () => {
    const user = await adapter.blockUntilReady();
    expect(user.pubkey).toBe('abc123pubkey');
    expect(mockSigner.getPublicKey).toHaveBeenCalledTimes(1);
  });

  it('caches user after first call', async () => {
    await adapter.blockUntilReady();
    await adapter.blockUntilReady();
    expect(mockSigner.getPublicKey).toHaveBeenCalledTimes(1);
  });

  it('provides pubkey synchronously after ready', async () => {
    await adapter.blockUntilReady();
    expect(adapter.pubkey).toBe('abc123pubkey');
  });

  it('signs events', async () => {
    const mockEvent = {
      kind: 1,
      content: 'test',
      tags: [],
      pubkey: 'abc123pubkey',
      created_at: 1234567890,
    };

    const sig = await adapter.sign(mockEvent);
    expect(sig).toBe('signature123');
    expect(mockSigner.signEvent).toHaveBeenCalled();
  });

  it('encrypts messages', async () => {
    // Use unknown to bypass NDKUser type requirements in tests
    const mockUser = { pubkey: 'recipient' } as unknown as Parameters<typeof adapter.encrypt>[0];
    const result = await adapter.encrypt(mockUser, 'hello');
    expect(result).toBe('encrypted');
    expect(mockSigner.encrypt).toHaveBeenCalledWith('recipient', 'hello');
  });

  it('decrypts messages', async () => {
    // Use unknown to bypass NDKUser type requirements in tests
    const mockUser = { pubkey: 'sender' } as unknown as Parameters<typeof adapter.decrypt>[0];
    const result = await adapter.decrypt(mockUser, 'ciphertext');
    expect(result).toBe('decrypted');
    expect(mockSigner.decrypt).toHaveBeenCalledWith('sender', 'ciphertext');
  });

  it('serializes to payload', async () => {
    await adapter.blockUntilReady();
    const payload = adapter.toPayload();
    const parsed = JSON.parse(payload);
    expect(parsed.type).toBe('cloistr-adapter');
    expect(parsed.pubkey).toBe('abc123pubkey');
  });
});
