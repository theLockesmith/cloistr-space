/**
 * @fileoverview Docs types
 * Document collaboration types
 */

/** Document metadata */
export interface Doc {
  id: string;
  title: string;
  description?: string;
  ownerPubkey: string;
  createdAt: string;
  updatedAt: string;
  blossomUrl?: string;
  encrypted: boolean;
}

/** Document with permissions and collaborators */
export interface DocDetail {
  document: Doc;
  permissions: Record<string, string>;
  collaborators: string[];
}

/** Document collaborator */
export interface DocCollaborator {
  pubkey: string;
  role: 'owner' | 'editor' | 'viewer';
  grantedAt: string;
}

/** Document version */
export interface DocVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  note?: string;
  createdAt: string;
  createdBy: string;
}
