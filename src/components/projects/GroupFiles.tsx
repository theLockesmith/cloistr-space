/**
 * @fileoverview Group files component
 * Displays files shared with a NIP-29 group
 */

import { useState, useCallback } from 'react';
import { useGroupFiles, type GroupFile } from '@/services/groups/useGroupFiles';
import { useFileUpload } from '@/services/cloistr/useFileUpload';

interface GroupFilesProps {
  groupId: string;
}

export function GroupFiles({ groupId }: GroupFilesProps) {
  const { files, isLoading, error, refresh } = useGroupFiles(groupId);
  const { upload, isUploading } = useFileUpload();
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    try {
      // Upload with h-tag for group association
      await upload(file, {
        publishMetadata: true,
        groupId,
      });
      refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    }

    // Reset input
    e.target.value = '';
  }, [upload, groupId, refresh]);

  return (
    <div className="flex h-full flex-col">
      {/* Header with upload button */}
      <div className="flex items-center justify-between border-b border-cloistr-light/10 px-4 py-3">
        <h3 className="font-medium text-cloistr-light">Shared Files</h3>
        <label className="cursor-pointer rounded-lg bg-cloistr-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-cloistr-primary/90">
          <input
            type="file"
            className="hidden"
            onChange={handleFileSelect}
            disabled={isUploading}
          />
          {isUploading ? 'Uploading...' : 'Upload'}
        </label>
      </div>

      {uploadError && (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2">
          <p className="text-sm text-red-400">{uploadError}</p>
        </div>
      )}

      {/* Files list */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 rounded-lg border border-cloistr-light/10 p-3">
                <div className="h-10 w-10 rounded bg-cloistr-light/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 rounded bg-cloistr-light/10" />
                  <div className="h-3 w-1/4 rounded bg-cloistr-light/10" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-red-400">{error}</p>
              <button
                onClick={refresh}
                className="mt-2 text-xs text-cloistr-primary underline hover:no-underline"
              >
                Try again
              </button>
            </div>
          </div>
        ) : files.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-cloistr-light/10">
                <svg className="h-6 w-6 text-cloistr-light/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm text-cloistr-light/40">No files shared yet</p>
              <p className="text-xs text-cloistr-light/30">Upload a file to share with the group</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {files.map((file) => (
              <FileRow key={file.id} file={file} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FileRow({ file }: { file: GroupFile }) {
  const isImage = file.mimeType?.startsWith('image/');
  const sizeStr = file.size ? formatFileSize(file.size) : undefined;
  const dateStr = new Date(file.createdAt * 1000).toLocaleDateString();

  return (
    <a
      href={file.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-3 transition-colors hover:bg-cloistr-light/10"
    >
      {/* Thumbnail or icon */}
      {isImage && file.thumbnail ? (
        <img
          src={file.thumbnail}
          alt=""
          className="h-10 w-10 rounded object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded bg-cloistr-primary/10 text-cloistr-primary">
          <FileIcon mimeType={file.mimeType} />
        </div>
      )}

      {/* File info */}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-cloistr-light">
          {file.name || 'Untitled'}
        </p>
        <div className="flex items-center gap-2 text-xs text-cloistr-light/40">
          {sizeStr && <span>{sizeStr}</span>}
          {sizeStr && <span>-</span>}
          <span>{dateStr}</span>
        </div>
      </div>

      {/* Download icon */}
      <svg className="h-5 w-5 text-cloistr-light/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
    </a>
  );
}

function FileIcon({ mimeType }: { mimeType?: string }) {
  if (mimeType?.startsWith('image/')) {
    return (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (mimeType?.startsWith('video/')) {
    return (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    );
  }
  if (mimeType?.startsWith('audio/')) {
    return (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
    );
  }
  if (mimeType === 'application/pdf') {
    return (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }
  // Default file icon
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}
