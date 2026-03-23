/**
 * @fileoverview File upload hook
 * Handles uploading files to Blossom and publishing kind:1063 metadata
 */

import { useState, useCallback } from 'react';
import { useNdk } from '@/services/nostr';
import { getBlossom, type BlobDescriptor, type UploadProgressCallback } from './blossom';

/** NIP-94 File Metadata kind */
const FILE_METADATA_KIND = 1063;

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
  const { publish, createEvent, isConnected } = useNdk();
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

        const descriptor = await blossom.upload(file, {
          filename: filename ?? file.name,
          onProgress,
        });

        // Publish kind:1063 metadata event
        if (publishMetadata && publish && createEvent && isConnected) {
          setState((prev) => ({ ...prev, progress: 0.95 }));

          const event = createEvent();
          if (event) {
            event.kind = FILE_METADATA_KIND;
            event.content = ''; // Content is optional for file metadata

            // Build tags per NIP-94
            const tags: string[][] = [
              ['url', descriptor.url],
              ['m', descriptor.mimeType],
              ['x', descriptor.sha256],
              ['size', descriptor.size.toString()],
              ['name', filename ?? file.name],
            ];

            // Add dimensions for images
            if (descriptor.mimeType.startsWith('image/')) {
              try {
                const dimensions = await getImageDimensions(file);
                if (dimensions) {
                  tags.push(['dim', `${dimensions.width}x${dimensions.height}`]);
                }
              } catch {
                // Ignore dimension errors
              }
            }

            // Add group association
            if (groupId) {
              tags.push(['h', groupId]);
            }

            event.tags = tags;

            try {
              await publish(event);
            } catch (err) {
              console.warn('Failed to publish file metadata:', err);
              // Don't fail the upload if metadata publish fails
            }
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
    [publish, createEvent, isConnected]
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
