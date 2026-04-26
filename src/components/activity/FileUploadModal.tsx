/**
 * @fileoverview File upload modal with drag-and-drop support
 * Uploads to Blossom and publishes kind:1063 metadata
 */

import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from 'react';
import { useFileUpload } from '@/services/cloistr';
import { useToast } from '@/components/common/Toast';

interface FileUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadComplete?: (url: string, filename: string) => void;
  /** Group to associate file with */
  groupId?: string;
}

export function FileUploadModal({
  isOpen,
  onClose,
  onUploadComplete,
  groupId,
}: FileUploadModalProps) {
  const { upload, isUploading, progress, error, reset } = useFileUpload();
  const toast = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Focus trap and keyboard handling
  useEffect(() => {
    if (!isOpen) return;

    // Focus drop zone when modal opens
    const timer = setTimeout(() => {
      dropZoneRef.current?.focus();
    }, 0);

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !isUploading) {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isUploading, onClose]);

  const handleClose = useCallback(() => {
    if (isUploading) return; // Don't allow closing during upload
    setSelectedFile(null);
    setIsDragging(false);
    reset();
    onClose();
  }, [isUploading, reset, onClose]);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setSelectedFile(files[0]);
    }
  }, []);

  const handleFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    try {
      const descriptor = await upload(selectedFile, {
        groupId,
        publishMetadata: true,
      });

      if (descriptor) {
        toast.success('File uploaded', `"${selectedFile.name}" uploaded successfully`);
        onUploadComplete?.(descriptor.url, selectedFile.name);
        handleClose();
      }
    } catch (err) {
      toast.error('Upload failed', err instanceof Error ? err.message : 'Failed to upload file');
    }
  }, [selectedFile, upload, groupId, onUploadComplete, handleClose, toast]);

  const triggerFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-file-title"
        className="w-full max-w-md rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 id="upload-file-title" className="text-lg font-semibold text-cloistr-light">Upload File</h2>
          <button
            onClick={handleClose}
            disabled={isUploading}
            className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light disabled:opacity-50"
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

        {/* Drop zone */}
        <div
          ref={dropZoneRef}
          tabIndex={0}
          role="button"
          aria-label={selectedFile ? `Selected file: ${selectedFile.name}. Click to change.` : 'Click or drag to select a file'}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={triggerFileSelect}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              triggerFileSelect();
            }
          }}
          className={`mb-4 cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-cloistr-primary ${
            isDragging
              ? 'border-cloistr-primary bg-cloistr-primary/10'
              : selectedFile
                ? 'border-green-500/50 bg-green-500/5'
                : 'border-cloistr-light/20 hover:border-cloistr-light/40 hover:bg-cloistr-light/5'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
          />

          {selectedFile ? (
            <div className="space-y-2">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20">
                <svg
                  className="h-6 w-6 text-green-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-cloistr-light">{selectedFile.name}</p>
              <p className="text-xs text-cloistr-light/60">
                {formatFileSize(selectedFile.size)}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-cloistr-light/10">
                <svg
                  className="h-6 w-6 text-cloistr-light/60"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
              </div>
              <p className="text-sm text-cloistr-light/80">
                Drop a file here or click to browse
              </p>
              <p className="text-xs text-cloistr-light/60">Any file type supported</p>
            </div>
          )}
        </div>

        {/* Progress bar */}
        {isUploading && (
          <div className="mb-4">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-cloistr-light/60">Uploading...</span>
              <span className="text-cloistr-primary">{Math.round(progress * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-cloistr-light/10">
              <div
                className="h-full bg-cloistr-primary transition-all duration-300"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={handleClose}
            disabled={isUploading}
            className="rounded-md border border-cloistr-light/20 px-4 py-2 text-sm font-medium text-cloistr-light hover:bg-cloistr-light/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!selectedFile || isUploading}
            className="rounded-md bg-cloistr-primary px-4 py-2 text-sm font-medium text-white hover:bg-cloistr-primary/90 disabled:opacity-50"
          >
            {isUploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Format bytes to human-readable size
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
