/**
 * @fileoverview File upload hook
 * Handles uploading files to Blossom and publishing kind:1063 metadata.
 * Request building lives in upload.ts, which a headless caller can use directly.
 */

import { useState, useCallback } from 'react';
import { useNdk, useHeadlessAdapters } from '@/services/nostr';
import { getBlossom, type BlobDescriptor, type UploadProgressCallback } from './blossom';
import { publishFileMetadata } from './upload';

export interface UploadState {
  isUploading: boolean;
  progress: number;
  error: string | null;
  lastUpload: BlobDescriptor | null;
}

export interface UseFileUploadReturn extends UploadState {
  upload: (file: File, options?: UploadOptions) => Promise<BlobDescriptor | null>;
  reset: () => void;
}

export interface UploadOptions {
  /** Group to associate file with (h tag) */
  groupId?: string;
  /** Custom filename override */
  filename?: string;
  /** Whether to publish kind:1063 event */
  publishMetadata?: boolean;
}

/**
 * Hook for uploading files to Blossom and publishing metadata
 */
export function useFileUpload(): UseFileUploadReturn {
  const { isConnected } = useNdk();
  const { signer, relay } = useHeadlessAdapters();
  const [state, setState] = useState<UploadState>({
    isUploading: false,
    progress: 0,
    error: null,
    lastUpload: null,
  });

  const upload = useCallback(
    async (file: File, options?: UploadOptions): Promise<BlobDescriptor | null> => {
      const { groupId, filename, publishMetadata = true } = options ?? {};

      setState({
        isUploading: true,
        progress: 0,
        error: null,
        lastUpload: null,
      });

      try {
        const blossom = getBlossom();

        // Upload to Blossom with progress tracking
        const onProgress: UploadProgressCallback = (progress) => {
          setState((prev) => ({ ...prev, progress: progress * 0.9 })); // Reserve 10% for metadata
        };

        if (!signer) throw new Error('Sign in to upload files.');
        const descriptor = await blossom.upload(signer, file, { onProgress });

        // Publish kind:1063 metadata. Failure here does not fail the upload:
        // the blob is stored and its URL works either way. With no relay
        // connection it is skipped outright, and the file will not appear in
        // listings built from kind:1063.
        if (publishMetadata && relay && isConnected) {
          setState((prev) => ({ ...prev, progress: 0.95 }));
          const dimensions = descriptor.mimeType.startsWith('image/')
            ? await getImageDimensions(file).catch(() => null)
            : null;
          try {
            await publishFileMetadata(signer, relay, descriptor, {
              name: filename ?? file.name,
              groupId,
              dimensions: dimensions ?? undefined,
            });
          } catch (err) {
            console.warn('Failed to publish file metadata:', err);
          }
        }

        setState({
          isUploading: false,
          progress: 1,
          error: null,
          lastUpload: descriptor,
        });

        return descriptor;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        setState({
          isUploading: false,
          progress: 0,
          error: message,
          lastUpload: null,
        });
        return null;
      }
    },
    [signer, relay, isConnected]
  );

  const reset = useCallback(() => {
    setState({
      isUploading: false,
      progress: 0,
      error: null,
      lastUpload: null,
    });
  }, []);

  return {
    ...state,
    upload,
    reset,
  };
}

/**
 * Get image dimensions from a File
 */
function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}
