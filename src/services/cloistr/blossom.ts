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
