/**
 * @fileoverview Drive requests carry the auth stash actually accepts.
 *
 * stash !189: the file, folder and share lists are owner-only and need a
 * NIP-98 (kind:27235) header whose u is the exact request URL and method the
 * request's method. A Blossom (kind:24242) header is valid only on the blob
 * routes: POST /api/files and DELETE /api/files/{sha256}, the delete naming
 * the blob in an x tag. Space sent no auth on the lists, a 24242 on folder
 * writes (refused), and a delete without x (refused).
 *
 * Rules mirrored from cloistr-stash internal/auth/authevent.go
 * ValidateAuthHeader.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/config/environment', () => ({ config: { driveApiUrl: 'https://stash.example' } }));

const { DriveClient, DriveNotSigned } = await import('./drive');

const ME = 'ab'.repeat(32);
const SHA = 'C0'.repeat(32);
const signEvent = vi.fn(async (e: object) => ({ ...e, id: 'id', sig: 'sig' }));
const signer = { getPublicKey: async () => ME, signEvent };
const fetchMock = vi.fn();

type Call = [string, { method?: string; headers?: Record<string, string> } | undefined];

function authOf(call: Call, header = 'Authorization') {
  const value = call[1]?.headers?.[header];
  expect(value, `${header} on ${call[0]}`).toMatch(/^Nostr /);
  return JSON.parse(atob(value!.slice(6))) as { kind: number; tags: string[][] };
}
const tag = (ev: { tags: string[][] }, name: string) => ev.tags.find((t) => t[0] === name)?.[1];

function expectNip98(call: Call, method: string) {
  const ev = authOf(call);
  expect(ev.kind).toBe(27235);
  expect(tag(ev, 'u')).toBe(call[0]);
  expect(tag(ev, 'method')).toBe(method);
  expect(tag(ev, 'nonce')).toMatch(/^[0-9a-f]{16}$/);
}

let drive: InstanceType<typeof DriveClient>;

beforeEach(() => {
  signEvent.mockReset().mockImplementation(async (e: object) => ({ ...e, id: 'id', sig: 'sig' }));
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'f1', name: 'x' }) });
  vi.stubGlobal('fetch', fetchMock);
  drive = new DriveClient();
  drive.setSigner(signer as never);
});

describe('owner-only reads are signed with NIP-98 for the exact URL', () => {
  it('listFiles', async () => {
    await drive.listFiles(ME, 'folder 1');
    const call = fetchMock.mock.calls[0] as Call;
    expect(call[0]).toBe(`https://stash.example/api/files?pubkey=${ME}&folder=folder+1`);
    expectNip98(call, 'GET');
  });

  it('listFiles with a signer passed in, and no client signer set', async () => {
    drive.setSigner(null);
    await drive.listFiles(ME, undefined, signer as never);
    expectNip98(fetchMock.mock.calls[0] as Call, 'GET');
  });

  it('listFolders, getFolder and listShares', async () => {
    await drive.listFolders(ME);
    await drive.getFolder('f1', ME);
    await drive.listShares(ME);
    for (const call of fetchMock.mock.calls as Call[]) expectNip98(call, 'GET');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('two signings of the same URL are different events', async () => {
    await drive.listFiles(ME);
    await drive.listFiles(ME);
    const [a, b] = (fetchMock.mock.calls as Call[]).map((c) => tag(authOf(c), 'nonce'));
    expect(a).not.toBe(b);
  });
});

describe('writes', () => {
  it('createFolder is NIP-98 POST on /api/folders', async () => {
    await drive.createFolder('Notes');
    const call = fetchMock.mock.calls[0] as Call;
    expect(call[0]).toBe('https://stash.example/api/folders');
    expect(call[1]?.method).toBe('POST');
    expectNip98(call, 'POST');
  });

  it('deleteFolder is NIP-98 DELETE on /api/folders/{id}', async () => {
    await drive.deleteFolder('f1');
    const call = fetchMock.mock.calls[0] as Call;
    expect(call[0]).toBe('https://stash.example/api/folders/f1');
    expectNip98(call, 'DELETE');
  });

  it('deleteFile is a Blossom delete naming the blob', async () => {
    await drive.deleteFile(SHA);
    const ev = authOf(fetchMock.mock.calls[0] as Call, 'X-Blossom-Auth');
    expect(ev.kind).toBe(24242);
    expect(tag(ev, 't')).toBe('delete');
    expect(tag(ev, 'x')).toBe(SHA.toLowerCase());
    expect(Number(tag(ev, 'expiration'))).toBeGreaterThan(Date.now() / 1000);
  });
});

describe('a refused signature', () => {
  it('is a DriveNotSigned, and nothing is sent', async () => {
    signEvent.mockRejectedValueOnce(new Error('user declined'));
    await expect(drive.listFiles(ME)).rejects.toBeInstanceOf(DriveNotSigned);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
