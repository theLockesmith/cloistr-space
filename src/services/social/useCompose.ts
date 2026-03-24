/**
 * @fileoverview Compose hook
 * Post notes with optional media and replies
 */

import { useState, useCallback } from 'react';
import { useNdk } from '@/services/nostr';
import { useAuthStore } from '@/stores/authStore';
import { useFileUpload } from '@/services/cloistr/useFileUpload';
import { NOTE_KIND, type ComposeOptions } from '@/types/social';

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
  const { publish, createEvent, isConnected } = useNdk();
  const { pubkey, isAuthenticated } = useAuthStore();
  const { upload, isUploading, progress } = useFileUpload();

  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPost = Boolean(publish && isConnected && isAuthenticated && pubkey);

  const post = useCallback(
    async (content: string, options?: ComposeOptions): Promise<string> => {
      if (!publish || !createEvent || !pubkey) {
        throw new Error('Not connected');
      }

      if (!content.trim() && (!options?.media || options.media.length === 0)) {
        throw new Error('Cannot post empty note');
      }

      setIsPosting(true);
      setError(null);

      try {
        const tags: string[][] = [];
        let finalContent = content;

        // Handle media uploads
        if (options?.media && options.media.length > 0) {
          for (const file of options.media) {
            const result = await upload(file, { publishMetadata: false });
            if (result?.url) {
              // Add URL to content
              finalContent += `\n${result.url}`;

              // Add imeta tag for rich media
              const imetaTag = ['imeta', `url ${result.url}`];
              if (file.type) {
                imetaTag.push(`m ${file.type}`);
              }
              tags.push(imetaTag);
            }
          }
        }

        // Handle reply
        if (options?.replyTo) {
          // Add reply tag with marker
          tags.push(['e', options.replyTo, '', 'reply']);

          // If we have a root, add it too
          // For now, treat replyTo as both root and reply for simple threads
          if (!tags.some((t) => t[0] === 'e' && t[3] === 'root')) {
            tags.push(['e', options.replyTo, '', 'root']);
          }
        }

        // Handle quote
        if (options?.quote) {
          tags.push(['q', options.quote]);
        }

        // Handle mentions
        if (options?.mentions) {
          for (const mention of options.mentions) {
            tags.push(['p', mention]);
          }
        }

        // Extract hashtags from content
        const hashtagMatches = finalContent.match(/#(\w+)/g) || [];
        for (const tag of hashtagMatches) {
          const hashtag = tag.slice(1).toLowerCase();
          if (!tags.some((t) => t[0] === 't' && t[1] === hashtag)) {
            tags.push(['t', hashtag]);
          }
        }

        // TODO: Extract mentions from content (@npub...) and convert to hex pubkeys
        // For now, inline mention parsing is not implemented

        const event = createEvent();
        if (!event) throw new Error('Failed to make event');

        event.kind = NOTE_KIND;
        event.content = finalContent.trim();
        event.tags = tags;

        await publish(event);

        return event.id ?? '';
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to post';
        setError(message);
        throw new Error(message, { cause: err });
      } finally {
        setIsPosting(false);
      }
    },
    [publish, createEvent, pubkey, upload]
  );

  return {
    post,
    isPosting: isPosting || isUploading,
    uploadProgress: progress,
    error,
    canPost,
  };
}
