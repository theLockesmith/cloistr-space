/**
 * Blossom upload, callable without React.
 *
 * Measured against files.cloistr.xyz on 2026-10-05 with a throwaway key:
 *   - PUT with no Authorization          -> 401
 *   - PUT multipart body, valid auth     -> 400 "blob hash doesn't match auth event 'x' tag"
 *   - PUT raw body, valid kind:24242 auth -> 200, blob served at its sha256
 * Space's uploader sent the first and second shapes, so no upload from Space
 * could succeed. These tests pin the third.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools';
import type { Event, UnsignedEvent } from 'nostr-tools';
import type { SignerInterface, RelayClient } from '../headless';
import { blossomAuthHeader, uploadBlob, publishFileMetadata } from './upload';

const BASE = 'https://files.example';

function realSigner(): SignerInterface & { pubkey: string } {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return {
    pubkey,
    getPublicKey: async () => pubkey,
    signEvent: async (u: UnsignedEvent) => finalizeEvent(u, sk) as Event,
    encrypt: async () => '',
    decrypt: async () => '',
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeAuth(header: string): Event {
  expect(header.startsWith('Nostr ')).toBe(true);
  return JSON.parse(atob(header.slice('Nostr '.length)));
}

describe('blossomAuthHeader', () => {
  it('signs a kind:24242 naming the action, the blob hash and an expiry', async () => {
    const signer = realSigner();
    const header = await blossomAuthHeader(signer, 'upload', 'ab'.repeat(32), 1000);
    const event = decodeAuth(header);

    expect(verifyEvent(event)).toBe(true);
    expect(event.kind).toBe(24242);
    expect(event.pubkey).toBe(signer.pubkey);
    expect(event.tags).toContainEqual(['t', 'upload']);
    expect(event.tags).toContainEqual(['x', 'ab'.repeat(32)]);
    const exp = Number(event.tags.find((t) => t[0] === 'expiration')![1]);
    expect(exp).toBeGreaterThan(event.created_at);
  });
});

describe('uploadBlob', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const bytes = new TextEncoder().encode('hello blossom');
  const blob = new Blob([bytes], { type: 'text/plain' });

  it('PUTs the raw bytes, not a form, with auth naming the same hash', async () => {
    const sha = await sha256Hex(bytes);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ url: `${BASE}/${sha}`, sha256: sha, size: bytes.length }), { status: 200 }),
    );

    const result = await uploadBlob(realSigner(), blob, { baseUrl: BASE });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/upload`);
    expect(init.method).toBe('PUT');
    expect(init.body).not.toBeInstanceOf(FormData);
    expect(Array.from(new Uint8Array(await (init.body as Blob).arrayBuffer()))).toEqual(Array.from(bytes));
    expect(init.headers['Content-Type']).toBe('text/plain');
    expect(decodeAuth(init.headers.Authorization).tags).toContainEqual(['x', sha]);
    expect(result).toMatchObject({ sha256: sha, url: `${BASE}/${sha}`, size: bytes.length, mimeType: 'text/plain' });
  });

  it('throws with the server reason on refusal', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'UPLOAD_FAILED', message: 'quota exceeded' }), { status: 413 }),
    );

    await expect(uploadBlob(realSigner(), blob, { baseUrl: BASE })).rejects.toThrow(/quota exceeded/);
  });

  it('throws when the server stored different bytes than we sent', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ url: `${BASE}/${'00'.repeat(32)}`, sha256: '00'.repeat(32) }), { status: 200 }),
    );

    await expect(uploadBlob(realSigner(), blob, { baseUrl: BASE })).rejects.toThrow(/hash/);
  });
});

describe('publishFileMetadata', () => {
  it('publishes a NIP-94 kind:1063 with url, type, hash, size, name, dimensions and group', async () => {
    const published: Event[] = [];
    const relay: RelayClient = { publish: async (e) => (published.push(e), 1), fetch: async () => [] };

    await publishFileMetadata(
      realSigner(),
      relay,
      { sha256: 'ab'.repeat(32), url: `${BASE}/x`, size: 5, mimeType: 'image/png', uploaded: 0 },
      { name: 'a.png', groupId: 'g1', dimensions: { width: 4, height: 3 } },
    );

    const e = published[0];
    expect(e.kind).toBe(1063);
    expect(e.tags).toEqual([
      ['url', `${BASE}/x`],
      ['m', 'image/png'],
      ['x', 'ab'.repeat(32)],
      ['size', '5'],
      ['name', 'a.png'],
      ['dim', '4x3'],
      ['h', 'g1'],
    ]);
  });
});
