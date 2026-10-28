import { describe, it, expect, vi } from 'vitest';
import { signerEcdhTag, signerHandoffBuckets } from './signerEcdh';

function mockNip46Signer(responses: Record<string, string>) {
  return {
    getPublicKey: vi.fn(),
    signEvent: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    sendRequest: vi.fn(async (method: string, params: string[]) => {
      const key = `${method}:${params.join(',')}`;
      if (key in responses) return responses[key];
      throw new Error(`unknown method ${method}`);
    }),
  };
}

function mockNip07Signer() {
  return {
    getPublicKey: vi.fn(),
    signEvent: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  };
}

describe('signerEcdhTag', () => {
  it('calls cloistr_ecdh_tag and returns 2-hex result', async () => {
    const signer = mockNip46Signer({
      'cloistr_ecdh_tag:deadbeef,20000': 'ab',
    });
    const result = await signerEcdhTag(signer, 'deadbeef', 20000);
    expect(result).toBe('ab');
    expect(signer.sendRequest).toHaveBeenCalledWith('cloistr_ecdh_tag', ['deadbeef', '20000']);
  });

  it('returns null for NIP-07 signers (no sendRequest)', async () => {
    const signer = mockNip07Signer();
    const result = await signerEcdhTag(signer, 'deadbeef', 20000);
    expect(result).toBeNull();
  });

  it('returns null when signer rejects the method', async () => {
    const signer = mockNip46Signer({});
    const result = await signerEcdhTag(signer, 'deadbeef', 20000);
    expect(result).toBeNull();
  });

  it('returns null for malformed responses', async () => {
    const signer = mockNip46Signer({
      'cloistr_ecdh_tag:deadbeef,20000': 'not-a-bucket',
    });
    const result = await signerEcdhTag(signer, 'deadbeef', 20000);
    expect(result).toBeNull();
  });
});

describe('signerHandoffBuckets', () => {
  it('returns bucket tags for each granter', async () => {
    const signer = mockNip46Signer({
      'cloistr_ecdh_tag:aaa,20000': '01',
      'cloistr_ecdh_tag:bbb,20000': 'ff',
    });
    const result = await signerHandoffBuckets(signer, ['aaa', 'bbb'], 20000);
    expect(result).toEqual(['01', 'ff']);
  });

  it('filters out failures', async () => {
    const signer = mockNip46Signer({
      'cloistr_ecdh_tag:aaa,20000': '01',
    });
    const result = await signerHandoffBuckets(signer, ['aaa', 'bbb'], 20000);
    expect(result).toEqual(['01']);
  });

  it('returns empty array for NIP-07 signer', async () => {
    const signer = mockNip07Signer();
    const result = await signerHandoffBuckets(signer, ['aaa', 'bbb'], 20000);
    expect(result).toEqual([]);
  });
});

describe('hand-off bucket tags are remembered per user, granter and day', () => {
  it('asks the signer once, then answers a reload from storage', async () => {
    // Live baseline 2026-10-28: the Threads page made 22 signer round trips on
    // every load for an account with no threads. A tag for a given user,
    // granter and day never changes, and the bucket it names is already on
    // the wire in the relay request.
    localStorage.clear();
    const signer = mockNip46Signer({
      'cloistr_ecdh_tag:g1,20000': 'ab',
      'cloistr_ecdh_tag:g2,20000': 'cd',
    });
    signer.getPublicKey.mockResolvedValue('a'.repeat(64));
    expect(await signerHandoffBuckets(signer, ['g1', 'g2'], 20000)).toEqual(['ab', 'cd']);
    expect(await signerHandoffBuckets(signer, ['g1', 'g2'], 20000)).toEqual(['ab', 'cd']);
    expect(signer.sendRequest).toHaveBeenCalledTimes(2);
  });

  it('does not answer another user from the first user\'s tags', async () => {
    localStorage.clear();
    const first = mockNip46Signer({ 'cloistr_ecdh_tag:g1,20000': 'ab' });
    first.getPublicKey.mockResolvedValue('a'.repeat(64));
    await signerHandoffBuckets(first, ['g1'], 20000);
    const second = mockNip46Signer({ 'cloistr_ecdh_tag:g1,20000': 'ef' });
    second.getPublicKey.mockResolvedValue('b'.repeat(64));
    expect(await signerHandoffBuckets(second, ['g1'], 20000)).toEqual(['ef']);
  });
});

describe('looking up two windows at once', () => {
  it('keeps both windows\' tags, so neither is asked for again', async () => {
    localStorage.clear();
    const signer = mockNip46Signer({
      'cloistr_ecdh_tag:g1,20000': 'ab',
      'cloistr_ecdh_tag:g1,19999': 'cd',
    });
    signer.getPublicKey.mockResolvedValue('a'.repeat(64));
    await Promise.all([signerHandoffBuckets(signer, ['g1'], 20000), signerHandoffBuckets(signer, ['g1'], 19999)]);
    await Promise.all([signerHandoffBuckets(signer, ['g1'], 20000), signerHandoffBuckets(signer, ['g1'], 19999)]);
    expect(signer.sendRequest).toHaveBeenCalledTimes(2);
  });
});
