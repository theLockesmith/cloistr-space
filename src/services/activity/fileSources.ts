/**
 * @fileoverview Where a user's files are, besides NIP-94 events.
 *
 * The Recent Files widget read only kind:1063 file-metadata events, and
 * nothing Space or Drive uploads publishes one, so it could never show a
 * Drive file or a Blossom blob (operator's account, 2026-10-16: 0 kind:1063
 * on any relay). Files live in two services:
 *
 *  - Drive (stash): lists by pubkey with no sign-in.
 *  - Blossom (files.cloistr.xyz): lists only for a request the user signed
 *    (kind:24242, t=list). For a remote signer that is an approval, so the
 *    signed list is made once per session and the result kept; a refusal is
 *    not kept, so a retry asks again.
 *
 * Either source failing is an error, never an empty list.
 */

import type { SignerInterface } from '@/services/headless';
import { config } from '@/config/environment';
import { getDrive } from '@/services/cloistr/drive';
import type { FileMetadata } from '@/types/activity';

/** Blossom/Nostr HTTP auth kind (BUD-01). */
const BLOSSOM_AUTH_KIND = 24242;

export async function listDriveFiles(pubkey: string): Promise<FileMetadata[]> {
  const drive = getDrive();
  const files = await drive.listFiles(pubkey);
  return files.map((f) => ({
    id: `drive:${f.sha256}`,
    pubkey,
    name: f.name || `${f.sha256.slice(0, 12)}…`,
    url: drive.getDownloadUrl(f.sha256),
    mimeType: f.mimeType || 'application/octet-stream',
    size: f.size,
    hash: f.sha256,
    createdAt: f.createdAt || 0,
  }));
}

interface BlobDescriptorJson {
  sha256?: string;
  url?: string;
  size?: number;
  type?: string;
  uploaded?: number;
}

/** A Blossom list could not be authorised: the signer refused or failed. */
export class BlossomListNotSigned extends Error {
  constructor(cause: unknown) {
    super(
      'Space needs your approval to list your files there, and did not get it' +
        (cause instanceof Error && cause.message ? ` (${cause.message})` : '')
    );
    this.name = 'BlossomListNotSigned';
  }
}

async function listAuthHeader(signer: SignerInterface): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  let event;
  try {
    event = await signer.signEvent({
      kind: BLOSSOM_AUTH_KIND,
      pubkey: await signer.getPublicKey(),
      created_at: now,
      content: 'list',
      tags: [
        ['t', 'list'],
        ['expiration', String(now + 300)],
      ],
    });
  } catch (err) {
    throw new BlossomListNotSigned(err);
  }
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

async function fetchBlossomList(signer: SignerInterface, pubkey: string): Promise<FileMetadata[]> {
  const base = config.blossomApiUrl.replace(/\/$/, '');
  const response = await fetch(`${base}/list/${pubkey}`, {
    headers: { Authorization: await listAuthHeader(signer) },
  });
  if (!response.ok) throw new Error(`Cloistr Files refused the list (${response.status}).`);
  const body: unknown = await response.json();
  const blobs: BlobDescriptorJson[] = Array.isArray(body)
    ? body
    : ((body as { blobs?: BlobDescriptorJson[] })?.blobs ?? []);
  return blobs
    .filter((b): b is Required<Pick<BlobDescriptorJson, 'sha256'>> & BlobDescriptorJson => typeof b.sha256 === 'string')
    .map((b) => ({
      id: `blossom:${b.sha256}`,
      pubkey,
      name: (b.url && decodeURIComponent(b.url.split('/').pop() ?? '')) || `${b.sha256.slice(0, 12)}…`,
      url: b.url || `${base}/${b.sha256}`,
      mimeType: b.type || 'application/octet-stream',
      size: b.size,
      hash: b.sha256,
      createdAt: b.uploaded || 0,
    }));
}

/** One signed list per key per session; failures are not kept. */
const blossomSession = new Map<string, Promise<FileMetadata[]>>();

export function listBlossomFiles(signer: SignerInterface, pubkey: string): Promise<FileMetadata[]> {
  const cached = blossomSession.get(pubkey);
  if (cached) return cached;
  const read = fetchBlossomList(signer, pubkey);
  blossomSession.set(pubkey, read);
  read.catch(() => {
    if (blossomSession.get(pubkey) === read) blossomSession.delete(pubkey);
  });
  return read;
}

/** Forget this session's Blossom lists (logout, tests). */
export function clearBlossomSession(): void {
  blossomSession.clear();
}

/**
 * Merge file lists, newest first, one entry per content hash. Earlier lists
 * win on a tie, so a NIP-94 event (with its name and thumbnail) beats the
 * bare service entry for the same blob.
 */
export function mergeFiles(lists: FileMetadata[][], limit: number): FileMetadata[] {
  const byKey = new Map<string, FileMetadata>();
  for (const list of lists) {
    for (const f of list) {
      const key = f.hash ?? f.id;
      if (!byKey.has(key)) byKey.set(key, f);
    }
  }
  return [...byKey.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}
