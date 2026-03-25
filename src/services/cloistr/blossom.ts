/**
 * @fileoverview Blossom client for file uploads
 * Blossom is a blob storage service using SHA256 hashes as identifiers
 */

import { config } from '@/config/environment';

/** Blossom blob descriptor returned after upload */
export interface BlobDescriptor {
  sha256: string;
  url: string;
  size: number;
  mimeType: string;
  uploaded: number;
}

/** Upload progress callback */
export type UploadProgressCallback = (progress: number) => void;

/**
 * Blossom client for blob storage operations
 */
export class BlossomClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = config.blossomApiUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Upload a file to Blossom
   * @param file File or Blob to upload
   * @param options Upload options
   * @returns Blob descriptor with URL and metadata
   */
  async upload(
    file: File | Blob,
    options?: {
      filename?: string;
      onProgress?: UploadProgressCallback;
      authHeader?: string; // NIP-98 auth header
    }
  ): Promise<BlobDescriptor> {
    const { filename, onProgress, authHeader } = options ?? {};

    // Calculate SHA256 hash of file
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const sha256 = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Check if file already exists
    const exists = await this.exists(sha256);
    if (exists) {
      return {
        sha256,
        url: `${this.baseUrl}/${sha256}`,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        uploaded: Date.now(),
      };
    }

    // Upload file
    const formData = new FormData();
    const uploadFile = file instanceof File ? file : new File([file], filename ?? 'file', { type: file.type });
    formData.append('file', uploadFile);

    const headers: Record<string, string> = {};
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    // Use XMLHttpRequest for progress tracking
    if (onProgress) {
      return this.uploadWithProgress(formData, headers, sha256, file, onProgress);
    }

    const response = await fetch(`${this.baseUrl}/upload`, {
      method: 'PUT',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Upload failed: ${error}`);
    }

    const result = await response.json();

    return {
      sha256,
      url: result.url ?? `${this.baseUrl}/${sha256}`,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      uploaded: Date.now(),
    };
  }

  /**
   * Upload with progress tracking using XMLHttpRequest
   */
  private uploadWithProgress(
    formData: FormData,
    headers: Record<string, string>,
    sha256: string,
    file: File | Blob,
    onProgress: UploadProgressCallback
  ): Promise<BlobDescriptor> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded / e.total);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const result = JSON.parse(xhr.responseText);
            resolve({
              sha256,
              url: result.url ?? `${this.baseUrl}/${sha256}`,
              size: file.size,
              mimeType: file.type || 'application/octet-stream',
              uploaded: Date.now(),
            });
          } catch {
            resolve({
              sha256,
              url: `${this.baseUrl}/${sha256}`,
              size: file.size,
              mimeType: file.type || 'application/octet-stream',
              uploaded: Date.now(),
            });
          }
        } else {
          reject(new Error(`Upload failed: ${xhr.statusText}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed: Network error'));
      });

      xhr.open('PUT', `${this.baseUrl}/upload`);

      // Set headers
      Object.entries(headers).forEach(([key, value]) => {
        if (typeof value === 'string') {
          xhr.setRequestHeader(key, value);
        }
      });

      xhr.send(formData);
    });
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
