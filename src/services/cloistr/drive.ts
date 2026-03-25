/**
 * @fileoverview Drive API client
 * Handles file and folder management with Blossom auth
 */

import { config } from '@/config/environment';
import type { SignerInterface } from '@cloistr/collab-common/auth';
import type { UnsignedEvent } from 'nostr-tools';
import type { DriveFile, DriveFolder, StorageQuota, FileShare, PublicLink } from '@/types/drive';

/** Blossom auth event kind */
const BLOSSOM_AUTH_KIND = 24242;

/** Convert snake_case API response to camelCase */
function mapFile(f: Record<string, unknown>): DriveFile {
  return {
    sha256: f.sha256 as string,
    name: f.name as string,
    size: f.size as number,
    mimeType: (f.mime_type ?? f.mimeType) as string,
    folderId: (f.folder_id ?? f.folderId ?? '') as string,
    createdAt: (f.created_at ?? f.createdAt) as number,
  };
}

function mapFolder(f: Record<string, unknown>): DriveFolder {
  return {
    id: f.id as string,
    name: f.name as string,
    parentId: (f.parent_id ?? f.parentId ?? '') as string,
    createdAt: (f.created_at ?? f.createdAt) as number,
  };
}

function mapQuota(q: Record<string, unknown>): StorageQuota {
  return {
    enabled: q.enabled as boolean,
    used: q.used as number,
    limit: q.limit as number,
    available: q.available as number,
    percent: q.percent as number,
    usedHuman: (q.used_human ?? q.usedHuman) as string,
    limitHuman: (q.limit_human ?? q.limitHuman) as string,
  };
}

function mapShare(s: Record<string, unknown>): FileShare {
  return {
    id: s.id as string,
    fileId: (s.file_id ?? s.fileId) as string,
    ownerPubkey: (s.owner_pubkey ?? s.ownerPubkey) as string,
    recipientPubkey: (s.recipient_pubkey ?? s.recipientPubkey) as string,
    permission: s.permission as 'read' | 'write',
    expiresAt: (s.expires_at ?? s.expiresAt) as number | undefined,
    createdAt: (s.created_at ?? s.createdAt) as number,
  };
}

function mapPublicLink(p: Record<string, unknown>): PublicLink {
  return {
    id: p.id as string,
    sha256: p.sha256 as string,
    fileName: (p.file_name ?? p.fileName) as string,
    fileSize: (p.file_size ?? p.fileSize) as number,
    fileMimeType: (p.file_mime_type ?? p.fileMimeType) as string,
    downloads: p.downloads as number,
    createdAt: (p.created_at ?? p.createdAt) as number,
  };
}

/** Re-export SignerInterface as AuthSigner for convenience */
export type AuthSigner = SignerInterface;

/**
 * Drive API client with Blossom authentication
 */
export class DriveClient {
  private readonly baseUrl: string;
  private signer: SignerInterface | null = null;

  constructor(baseUrl: string = config.driveApiUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** Set the auth signer */
  setSigner(signer: AuthSigner | null): void {
    this.signer = signer;
  }

  /** Generate Blossom auth header */
  private async getAuthHeader(action: string): Promise<string> {
    if (!this.signer) {
      throw new Error('No signer configured');
    }

    const pubkey = await this.signer.getPublicKey();
    const now = Math.floor(Date.now() / 1000);

    const event: UnsignedEvent = {
      kind: BLOSSOM_AUTH_KIND,
      pubkey,
      created_at: now,
      tags: [
        ['t', action],
        ['expiration', String(now + 600)],
      ],
      content: '',
    };

    const signedEvent = await this.signer.signEvent(event);
    return `Nostr ${btoa(JSON.stringify(signedEvent))}`;
  }

  /** List files for a pubkey */
  async listFiles(pubkey: string, folderId?: string): Promise<DriveFile[]> {
    const params = new URLSearchParams({ pubkey });
    if (folderId !== undefined) {
      params.set('folder', folderId);
    }

    const response = await fetch(`${this.baseUrl}/api/files?${params}`);
    if (!response.ok) {
      throw new Error(`Failed to list files: ${response.statusText}`);
    }

    const data = await response.json();
    return (data.files || []).map(mapFile);
  }

  /** List folders for a pubkey */
  async listFolders(pubkey: string, parentId?: string): Promise<DriveFolder[]> {
    const params = new URLSearchParams({ pubkey });
    if (parentId !== undefined) {
      params.set('parent', parentId);
    }

    const response = await fetch(`${this.baseUrl}/api/folders?${params}`);
    if (!response.ok) {
      throw new Error(`Failed to list folders: ${response.statusText}`);
    }

    const data = await response.json();
    return (data.folders || []).map(mapFolder);
  }

  /** Get folder by ID */
  async getFolder(folderId: string, pubkey: string): Promise<DriveFolder | null> {
    const params = new URLSearchParams({ pubkey });
    const response = await fetch(`${this.baseUrl}/api/folders/${folderId}?${params}`);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to get folder: ${response.statusText}`);
    }

    return mapFolder(await response.json());
  }

  /** Create a folder */
  async createFolder(name: string, parentId: string = ''): Promise<DriveFolder> {
    const authHeader = await this.getAuthHeader('upload');
    const pubkey = await this.signer!.getPublicKey();
    const now = Math.floor(Date.now() / 1000);

    const event: UnsignedEvent = {
      kind: 30079,
      pubkey,
      created_at: now,
      tags: [
        ['d', `folder:${Date.now()}`],
        ['name', name],
        ['parent', parentId],
      ],
      content: JSON.stringify({ name }),
    };

    const signedEvent = await this.signer!.signEvent(event);

    const response = await fetch(`${this.baseUrl}/api/folders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(signedEvent),
    });

    if (!response.ok) {
      throw new Error(`Failed to create folder: ${response.statusText}`);
    }

    return mapFolder(await response.json());
  }

  /** Delete a folder */
  async deleteFolder(folderId: string): Promise<void> {
    const authHeader = await this.getAuthHeader('delete');
    const pubkey = await this.signer!.getPublicKey();
    const now = Math.floor(Date.now() / 1000);

    const event: UnsignedEvent = {
      kind: 5,
      pubkey,
      created_at: now,
      tags: [['e', folderId]],
      content: '',
    };

    const signedEvent = await this.signer!.signEvent(event);

    const response = await fetch(`${this.baseUrl}/api/folders/${folderId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(signedEvent),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete folder: ${response.statusText}`);
    }
  }

  /** Delete a file */
  async deleteFile(sha256: string): Promise<void> {
    const authHeader = await this.getAuthHeader('delete');

    const response = await fetch(`${this.baseUrl}/api/files/${sha256}`, {
      method: 'DELETE',
      headers: {
        'X-Blossom-Auth': authHeader,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to delete file: ${response.statusText}`);
    }
  }

  /** Get storage quota */
  async getQuota(pubkey: string): Promise<StorageQuota> {
    const response = await fetch(`${this.baseUrl}/api/quota?pubkey=${pubkey}`);
    if (!response.ok) {
      throw new Error(`Failed to get quota: ${response.statusText}`);
    }

    return mapQuota(await response.json());
  }

  /** List shares */
  async listShares(pubkey: string, type: 'created' | 'received' | 'all' = 'all'): Promise<FileShare[]> {
    const params = new URLSearchParams({ pubkey, type });
    const response = await fetch(`${this.baseUrl}/api/shares?${params}`);

    if (!response.ok) {
      throw new Error(`Failed to list shares: ${response.statusText}`);
    }

    const data = await response.json();
    const shares = [...(data.shares || []), ...(data.received || [])];
    return shares.map(mapShare);
  }

  /** Get public link metadata */
  async getPublicLink(sha256: string): Promise<PublicLink | null> {
    const response = await fetch(`${this.baseUrl}/api/public/${sha256}`);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to get public link: ${response.statusText}`);
    }

    return mapPublicLink(await response.json());
  }

  /** Get file download URL */
  getDownloadUrl(sha256: string): string {
    return `${this.baseUrl}/api/files/${sha256}/download`;
  }

  /** Get public link URL (with fragment placeholder for key) */
  getPublicUrl(sha256: string): string {
    return `${this.baseUrl}/public/${sha256}`;
  }
}

/** Singleton instance */
let driveClient: DriveClient | null = null;

/** Get the Drive client singleton */
export function getDrive(): DriveClient {
  if (!driveClient) {
    driveClient = new DriveClient();
  }
  return driveClient;
}
