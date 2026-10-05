/**
 * @fileoverview Blossom client for file uploads
 * Blossom is a blob storage service using SHA256 hashes as identifiers
 */

import { config } from '@/config/environment';
import type { SignerInterface } from '../headless';
import { sha256Hex, uploadBlob, type BlobDescriptor, type UploadProgressCallback } from './upload';

export type { BlobDescriptor, UploadProgressCallback } from './upload';

/**
 * Blossom client for blob storage operations
 */
export class BlossomClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = config.blossomApiUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Upload a file to Blossom, signed by `signer` (BUD-02 kind:24242 auth).
   * See upload.ts for the request shape the server enforces.
   */
  async upload(
    signer: SignerInterface,
    file: File | Blob,
    options?: { onProgress?: UploadProgressCallback }
  ): Promise<BlobDescriptor> {
    // Already stored: Blossom addresses by content, so the same bytes are the
    // same blob whoever uploaded them.
    const sha256 = await sha256Hex(file);
    if (await this.exists(sha256)) {
      return {
        sha256,
        url: `${this.baseUrl}/${sha256}`,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        uploaded: Date.now(),
      };
    }

    return uploadBlob(signer, file, { baseUrl: this.baseUrl, onProgress: options?.onProgress, sha256 });
  }

  /**
   * Check if a blob exists on the server
   */
  async exists(sha256: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/${sha256}`, {
        method: 'HEAD',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get the URL for a blob
   */
  getUrl(sha256: string): string {
    return `${this.baseUrl}/${sha256}`;
  }

  /**
   * Delete a blob (requires authentication)
   */
  async delete(sha256: string, authHeader: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/${sha256}`, {
      method: 'DELETE',
      headers: {
        'Authorization': authHeader,
      },
    });
    return response.ok;
  }
}

/** Singleton instance */
let blossomClient: BlossomClient | null = null;

/**
 * Get the Blossom client singleton
 */
export function getBlossom(): BlossomClient {
  if (!blossomClient) {
    blossomClient = new BlossomClient();
  }
  return blossomClient;
}

/**
 * CDN URL utilities for Blossom files
 */
export const cdnUrl = {
  /**
   * Parse a Blossom URL and extract the SHA256 hash
   * Handles various formats: blossom://, https://files.cloistr.xyz/, etc.
   */
  parseHash(url: string): string | null {
    // Handle blossom:// protocol
    if (url.startsWith('blossom://')) {
      return url.slice(10);
    }

    // Handle full URLs - extract hash from path
    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const hash = pathParts[pathParts.length - 1];

      // Validate it looks like a SHA256 hash (64 hex chars)
      if (/^[a-f0-9]{64}$/i.test(hash)) {
        return hash.toLowerCase();
      }
    } catch {
      // Not a valid URL
    }

    // Check if it's already a raw hash
    if (/^[a-f0-9]{64}$/i.test(url)) {
      return url.toLowerCase();
    }

    return null;
  },

  /**
   * Convert a hash to a CDN URL
   */
  toUrl(hash: string, baseUrl?: string): string {
    const base = baseUrl ?? config.blossomApiUrl;
    return `${base.replace(/\/$/, '')}/${hash}`;
  },

  /**
   * Convert any Blossom URL format to a CDN URL
   */
  normalize(url: string, baseUrl?: string): string | null {
    const hash = cdnUrl.parseHash(url);
    if (!hash) return null;
    return cdnUrl.toUrl(hash, baseUrl);
  },

  /**
   * Check if a URL is a Blossom URL (any format)
   */
  isBlossom(url: string): boolean {
    return cdnUrl.parseHash(url) !== null;
  },

  /**
   * Get thumbnail URL with size parameters (if supported by CDN)
   */
  thumbnail(hash: string, width: number, height?: number, baseUrl?: string): string {
    const base = baseUrl ?? config.blossomApiUrl;
    const h = height ?? width;
    return `${base.replace(/\/$/, '')}/${hash}?w=${width}&h=${h}`;
  },
};
