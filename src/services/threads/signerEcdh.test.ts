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
