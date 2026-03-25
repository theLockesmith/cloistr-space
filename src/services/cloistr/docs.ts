/**
 * @fileoverview Docs API client
 * Handle document collaboration
 */

import type { Doc, DocDetail, DocCollaborator, DocVersion } from '@/types/docs';

/** Default docs API URL - no env var yet, use placeholder */
const DEFAULT_DOCS_URL = 'https://docs-api.cloistr.xyz';

/** Convert snake_case to camelCase for documents */
function mapDoc(d: Record<string, unknown>): Doc {
  return {
    id: d.id as string,
    title: d.title as string,
    description: d.description as string | undefined,
    ownerPubkey: (d.owner_pubkey ?? d.ownerPubkey) as string,
    createdAt: (d.created_at ?? d.createdAt) as string,
    updatedAt: (d.updated_at ?? d.updatedAt) as string,
    blossomUrl: (d.blossom_url ?? d.blossomUrl) as string | undefined,
    encrypted: d.encrypted as boolean,
  };
}

function mapCollaborator(c: Record<string, unknown>): DocCollaborator {
  return {
    pubkey: c.pubkey as string,
    role: c.role as 'owner' | 'editor' | 'viewer',
    grantedAt: (c.granted_at ?? c.grantedAt) as string,
  };
}

function mapVersion(v: Record<string, unknown>): DocVersion {
  return {
    id: v.id as string,
    documentId: (v.document_id ?? v.documentId) as string,
    versionNumber: (v.version_number ?? v.versionNumber) as number,
    note: v.note as string | undefined,
    createdAt: (v.created_at ?? v.createdAt) as string,
    createdBy: (v.created_by ?? v.createdBy) as string,
  };
}

/**
 * Docs API client for document collaboration
 */
export class DocsClient {
  private readonly baseUrl: string;
  private authPubkey: string | null = null;

  constructor(baseUrl: string = DEFAULT_DOCS_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** Set authenticated pubkey */
  setAuth(pubkey: string | null): void {
    this.authPubkey = pubkey;
  }

  private async fetch<T>(path: string, options: globalThis.RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.authPubkey) {
      headers['X-Dev-Pubkey'] = this.authPubkey;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  /** List user's documents */
  async listDocuments(page = 1, limit = 20): Promise<{ documents: Doc[]; total: number }> {
    const data = await this.fetch<{ documents: Record<string, unknown>[]; total: number }>(
      `/api/v1/documents?page=${page}&limit=${limit}`
    );
    return {
      documents: data.documents.map(mapDoc),
      total: data.total,
    };
  }

  /** Get document details */
  async getDocument(id: string): Promise<DocDetail> {
    const data = await this.fetch<{
      document: Record<string, unknown>;
      permissions: Record<string, string>;
      collaborators: string[];
    }>(`/api/v1/documents/${id}`);

    return {
      document: mapDoc(data.document),
      permissions: data.permissions,
      collaborators: data.collaborators,
    };
  }

  /** Create a new document */
  async createDocument(title: string, description?: string): Promise<Doc> {
    const data = await this.fetch<Record<string, unknown>>('/api/v1/documents', {
      method: 'POST',
      body: JSON.stringify({ title, description }),
    });
    return mapDoc(data);
  }

  /** Update document metadata */
  async updateDocument(id: string, updates: { title?: string; description?: string }): Promise<Doc> {
    const data = await this.fetch<Record<string, unknown>>(`/api/v1/documents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return mapDoc(data);
  }

  /** Delete a document */
  async deleteDocument(id: string): Promise<void> {
    await this.fetch(`/api/v1/documents/${id}`, {
      method: 'DELETE',
    });
  }

  /** List document collaborators */
  async listCollaborators(documentId: string): Promise<DocCollaborator[]> {
    const data = await this.fetch<{ collaborators: Record<string, unknown>[] }>(
      `/api/v1/documents/${documentId}/collaborators`
    );
    return data.collaborators.map(mapCollaborator);
  }

  /** Add collaborator to document */
  async addCollaborator(
    documentId: string,
    pubkey: string,
    role: 'editor' | 'viewer'
  ): Promise<DocCollaborator> {
    const data = await this.fetch<Record<string, unknown>>(
      `/api/v1/documents/${documentId}/collaborators`,
      {
        method: 'POST',
        body: JSON.stringify({ pubkey, role }),
      }
    );
    return mapCollaborator(data);
  }

  /** Remove collaborator from document */
  async removeCollaborator(documentId: string, pubkey: string): Promise<void> {
    await this.fetch(`/api/v1/documents/${documentId}/collaborators/${pubkey}`, {
      method: 'DELETE',
    });
  }

  /** List document versions */
  async listVersions(documentId: string): Promise<DocVersion[]> {
    const data = await this.fetch<{ versions: Record<string, unknown>[] }>(
      `/api/v1/documents/${documentId}/versions`
    );
    return data.versions.map(mapVersion);
  }

  /** Create a new version */
  async createVersion(documentId: string, note?: string): Promise<DocVersion> {
    const data = await this.fetch<Record<string, unknown>>(
      `/api/v1/documents/${documentId}/versions`,
      {
        method: 'POST',
        body: JSON.stringify({ note }),
      }
    );
    return mapVersion(data);
  }

  /** Restore a previous version */
  async restoreVersion(documentId: string, versionId: string): Promise<void> {
    await this.fetch(`/api/v1/documents/${documentId}/versions/${versionId}/restore`, {
      method: 'POST',
    });
  }

  /** Get WebSocket URL for real-time collaboration */
  getWebSocketUrl(documentId: string): string {
    const wsBase = this.baseUrl.replace(/^http/, 'ws');
    return `${wsBase}/api/v1/ws/documents/${documentId}`;
  }

  /** Get the editor URL for a document */
  getEditorUrl(documentId: string): string {
    return `${this.baseUrl}/edit/${documentId}`;
  }
}

/** Singleton instance */
let docsClient: DocsClient | null = null;

/** Get the Docs client singleton */
export function getDocs(): DocsClient {
  if (!docsClient) {
    docsClient = new DocsClient();
  }
  return docsClient;
}
