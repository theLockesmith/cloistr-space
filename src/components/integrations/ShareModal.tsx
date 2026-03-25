/**
 * @fileoverview Share modal for Drive files
 * Generate sharing links and manage permissions
 */

import { useState, useCallback } from 'react';
import { getDrive } from '@/services/cloistr';
import type { DriveFile } from '@/types/drive';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: DriveFile | null;
}

export function ShareModal({ isOpen, onClose, file }: ShareModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = useCallback(async () => {
    if (!file) return;

    const drive = getDrive();
    const url = drive.getDownloadUrl(file.sha256);

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [file]);

  if (!isOpen || !file) return null;

  const drive = getDrive();
  const downloadUrl = drive.getDownloadUrl(file.sha256);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-cloistr-light">Share File</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* File info */}
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-cloistr-light/5 p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-cloistr-light/10 text-xl">
            {file.mimeType.startsWith('image/') ? '🖼️' : '📄'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-cloistr-light">{file.name}</p>
            <p className="text-xs text-cloistr-light/40">
              {formatSize(file.size)}
            </p>
          </div>
        </div>

        {/* Download link */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-cloistr-light/60">
            Download Link
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={downloadUrl}
              className="flex-1 rounded-md border border-cloistr-light/20 bg-cloistr-darker px-3 py-2 text-sm text-cloistr-light"
            />
            <button
              onClick={handleCopyLink}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                copied
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-cloistr-primary text-white hover:bg-cloistr-primary/90'
              }`}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Note about public links */}
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
          <p className="text-sm text-yellow-400/80">
            Anyone with this link can download the file. For encrypted sharing, use the Nostr-based sharing feature (coming soon).
          </p>
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
