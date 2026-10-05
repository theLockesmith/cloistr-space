/**
 * @fileoverview Compose hook
 * Post notes with optional media and replies. Uploads happen here; event
 * building lives in noteService.ts, which a headless caller can use directly.
 */

import { useState, useCallback } from 'react';
import { useNdk, useHeadlessAdapters } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { useFileUpload } from '@/services/cloistr/useFileUpload';
import type { ComposeOptions } from '@/types/social';
import { postNote, type UploadedMedia } from './noteService';

interface UseComposeReturn {
  /** Post a note */
  post: (content: string, options?: ComposeOptions) => Promise<string>;
  /** Current posting state */
  isPosting: boolean;
  /** Upload progress (0-100) */
  uploadProgress: number;
  /** Error from last post attempt */
  error: string | null;
  /** Whether can post */
  canPost: boolean;
}

/**
 * Hook for composing and posting notes
 */
export function useCompose(): UseComposeReturn {
  const { publish, isConnected } = useNdk();
  const { signer, relay } = useHeadlessAdapters();
  const { pubkey, isAuthenticated } = useAuthStore();
  const { upload, isUploading, progress } = useFileUpload();

  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPost = Boolean(publish && isConnected && isAuthenticated && pubkey);

  const post = useCallback(
    async (content: string, options?: ComposeOptions): Promise<string> => {
      if (!signer || !relay) {
        throw new Error('Not connected');
      }

      if (!content.trim() && (!options?.media || options.media.length === 0)) {
        throw new Error('Cannot post empty note');
      }

      setIsPosting(true);
      setError(null);

      try {
        // Upload first; the note references the uploaded URLs.
        // A failed upload stops the post: publishing without media the user
        // attached claims a post they did not write.
        const files = options?.media ?? [];
        const media: UploadedMedia[] = [];
        for (const file of files) {
          const result = await upload(file, { publishMetadata: false });
          if (result?.url) media.push({ url: result.url, mimeType: file.type || undefined });
        }
        if (media.length < files.length) {
          throw new Error(
            `${files.length - media.length} of ${files.length} attachments failed to upload. Nothing was posted.`
          );
        }

        // TODO: Extract mentions from content (@npub...) and convert to hex pubkeys
        const outcome = await postNote(signer, relay, content, {
          replyTo: options?.replyTo,
          quote: options?.quote,
          mentions: options?.mentions,
          media,
        });
        return outcome.eventId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to post';
        setError(message);
        throw new Error(message, { cause: err });
      } finally {
        setIsPosting(false);
      }
    },
    [signer, relay, upload]
  );

  return {
    post,
    isPosting: isPosting || isUploading,
    uploadProgress: progress,
    error,
    canPost,
  };
}
