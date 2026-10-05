/**
 * Blossom upload and NIP-94 file metadata, callable without React.
 *
 * Takes a SignerInterface (and a RelayClient for metadata) like the other pure
 * modules, so a headless caller holding its own key uploads through the same
 * code as the UI.
 *
 * The request shape is BUD-02, and files.cloistr.xyz enforces both halves of
 * it (measured 2026-10-05): an Authorization header carrying a signed
 * kind:24242 whose `x` tag names the blob's sha256, and the RAW bytes as the
 * body. A multipart body is hashed as the multipart envelope, so it never
 * matches `x` and is refused even with valid auth.
 */

import { config } from '@/config/environment';
import { signAndPublish, type SignerInterface, type RelayClient, type PublishOutcome } from '../headless';

/** BUD-01/02 authorization event kind. */
export const BLOSSOM_AUTH_KIND = 24242;

/** NIP-94 file metadata kind. */
export const FILE_METADATA_KIND = 1063;

/** Blossom blob descriptor returned after upload. */
export interface BlobDescriptor {
  sha256: string;
  url: string;
  size: number;
  mimeType: string;
  uploaded: number;
}

/** Upload progress, 0 to 1. */
export type UploadProgressCallback = (progress: number) => void;

export interface UploadBlobOptions {
  baseUrl?: string;
  /** Browser only: reports progress through XMLHttpRequest. */
  onProgress?: UploadProgressCallback;
  /** Precomputed hash of `blob`, to avoid hashing a large file twice. */
  sha256?: string;
}

export async function sha256Hex(data: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `Nostr <base64 kind:24242>` authorizing one action on one blob. */
export async function blossomAuthHeader(
  signer: SignerInterface,
  action: 'upload' | 'delete' | 'get' | 'list',
  sha256: string,
  ttlSec = 300,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const event = await signer.signEvent({
    kind: BLOSSOM_AUTH_KIND,
    pubkey: await signer.getPublicKey(),
    created_at: now,
    content: `${action} ${sha256}`,
    tags: [
      ['t', action],
      ['x', sha256],
      ['expiration', String(now + ttlSec)],
    ],
  });
  // btoa only takes Latin-1. Safe because every field here is ASCII by
  // construction (action is a fixed word, the rest hex). Putting a filename in
  // `content` would need UTF-8 encoding first.
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

/** Pull the server's reason out of a refusal body, which is JSON or text. */
function refusalReason(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (parsed?.message) return `Upload failed (${status}): ${parsed.message}`;
  } catch {
    // not JSON
  }
  return `Upload failed (${status})${body ? `: ${body.slice(0, 200)}` : ''}`;
}

function putWithProgress(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: UploadProgressCallback,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => resolve({ status: xhr.status, body: xhr.responseText }));
    xhr.addEventListener('error', () => reject(new Error('Upload failed: network error')));
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.send(body);
  });
}

/**
 * Upload a blob and return where it lives.
 *
 * Throws on refusal (with the server's reason) and when the server reports a
 * different hash than the bytes we sent: a URL for someone else's bytes is not
 * a successful upload of ours.
 */
export async function uploadBlob(
  signer: SignerInterface,
  blob: Blob,
  options: UploadBlobOptions = {},
): Promise<BlobDescriptor> {
  const baseUrl = (options.baseUrl ?? config.blossomApiUrl).replace(/\/$/, '');
  const sha256 = options.sha256 ?? (await sha256Hex(blob));
  const mimeType = blob.type || 'application/octet-stream';
  const headers = {
    Authorization: await blossomAuthHeader(signer, 'upload', sha256),
    'Content-Type': mimeType,
  };
  const url = `${baseUrl}/upload`;

  let status: number;
  let text: string;
  if (options.onProgress && typeof XMLHttpRequest !== 'undefined') {
    ({ status, body: text } = await putWithProgress(url, headers, blob, options.onProgress));
  } else {
    // Same wording as the XHR path, so the message does not depend on whether
    // a progress bar was showing.
    const response = await fetch(url, { method: 'PUT', headers, body: blob }).catch((err: unknown) => {
      throw new Error(`Upload failed: ${err instanceof Error ? err.message : 'network error'}`);
    });
    status = response.status;
    text = await response.text();
  }

  if (status < 200 || status >= 300) throw new Error(refusalReason(status, text));

  let result: { url?: string; sha256?: string } = {};
  try {
    result = JSON.parse(text);
  } catch {
    // A 2xx without a descriptor still means stored; fall back to the hash URL.
  }
  if (result.sha256 && result.sha256 !== sha256) {
    throw new Error(`Upload failed: server stored hash ${result.sha256}, expected ${sha256}`);
  }

  return {
    sha256,
    url: result.url ?? `${baseUrl}/${sha256}`,
    size: blob.size,
    mimeType,
    uploaded: Date.now(),
  };
}

export interface FileMetadataOptions {
  name: string;
  groupId?: string;
  dimensions?: { width: number; height: number };
}

/** Publish a NIP-94 kind:1063 describing an uploaded blob. */
export function publishFileMetadata(
  signer: SignerInterface,
  relay: RelayClient,
  descriptor: BlobDescriptor,
  options: FileMetadataOptions,
): Promise<PublishOutcome> {
  const tags: string[][] = [
    ['url', descriptor.url],
    ['m', descriptor.mimeType],
    ['x', descriptor.sha256],
    ['size', descriptor.size.toString()],
    ['name', options.name],
  ];
  if (options.dimensions) tags.push(['dim', `${options.dimensions.width}x${options.dimensions.height}`]);
  if (options.groupId) tags.push(['h', options.groupId]);

  return signAndPublish(signer, relay, { kind: FILE_METADATA_KIND, content: '', tags });
}
