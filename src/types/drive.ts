/**
 * @fileoverview Drive types
 * File and folder management types
 */

/** File metadata from Drive API */
export interface DriveFile {
  sha256: string;
  name: string;
  size: number;
  mimeType: string;
  folderId: string;
  createdAt: number;
}

/** Folder metadata */
export interface DriveFolder {
  id: string;
  name: string;
  parentId: string;
  createdAt: number;
}

/** Storage quota info */
export interface StorageQuota {
  enabled: boolean;
  used: number;
  limit: number;
  available: number;
  percent: number;
  usedHuman: string;
  limitHuman: string;
}

/** File share */
export interface FileShare {
  id: string;
  fileId: string;
  ownerPubkey: string;
  recipientPubkey: string;
  permission: 'read' | 'write';
  expiresAt?: number;
  createdAt: number;
}

/** Public link metadata */
export interface PublicLink {
  id: string;
  sha256: string;
  fileName: string;
  fileSize: number;
  fileMimeType: string;
  downloads: number;
  createdAt: number;
}

/** Navigation breadcrumb */
export interface Breadcrumb {
  id: string;
  name: string;
}
