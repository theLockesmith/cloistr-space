/**
 * @fileoverview File browser component
 * Browse Drive files and folders with navigation
 */

import { useState, useCallback } from 'react';
import { useDrive } from '@/services/cloistr';
import { getDrive } from '@/services/cloistr';
import { FileUploadModal } from '@/components/activity/FileUploadModal';
import type { DriveFile, DriveFolder } from '@/types/drive';

interface FileBrowserProps {
  /** Initial folder to open */
  initialFolder?: string;
  /** Called when a file is selected */
  onFileSelect?: (file: DriveFile) => void;
  /** Called when sharing a file */
  onShare?: (file: DriveFile) => void;
  /** Whether to show upload button */
  showUpload?: boolean;
}

export function FileBrowser({
  initialFolder = '',
  onFileSelect,
  onShare,
  showUpload = true,
}: FileBrowserProps) {
  const {
    files,
    folders,
    breadcrumbs,
    quota,
    isLoading,
    error,
    navigateTo,
    createFolder,
    deleteFile,
    deleteFolder,
    refresh,
  } = useDrive({ initialFolder });

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) return;

    await createFolder(newFolderName.trim());
    setNewFolderName('');
    setShowNewFolderInput(false);
  }, [newFolderName, createFolder]);

  const handleDeleteFile = useCallback(async (file: DriveFile) => {
    if (!confirm(`Delete "${file.name}"?`)) return;
    await deleteFile(file.sha256);
    setSelectedItem(null);
  }, [deleteFile]);

  const handleDeleteFolder = useCallback(async (folder: DriveFolder) => {
    if (!confirm(`Delete folder "${folder.name}" and all its contents?`)) return;
    await deleteFolder(folder.id);
    setSelectedItem(null);
  }, [deleteFolder]);

  const handleFileClick = useCallback((file: DriveFile) => {
    setSelectedItem(`file:${file.sha256}`);
    onFileSelect?.(file);
  }, [onFileSelect]);

  const handleFolderClick = useCallback((folder: DriveFolder) => {
    navigateTo(folder.id);
  }, [navigateTo]);

  const handleDownload = useCallback((file: DriveFile) => {
    const drive = getDrive();
    window.open(drive.getDownloadUrl(file.sha256), '_blank');
  }, []);

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('document') || mimeType.includes('word')) return '📝';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽️';
    if (mimeType.includes('zip') || mimeType.includes('archive')) return '📦';
    return '📄';
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header with breadcrumbs and actions */}
      <div className="mb-4 flex items-center justify-between">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 text-sm">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center">
              {i > 0 && <span className="mx-1 text-cloistr-light/40">/</span>}
              <button
                onClick={() => navigateTo(crumb.id)}
                className={`rounded px-1 py-0.5 hover:bg-cloistr-light/10 ${
                  i === breadcrumbs.length - 1
                    ? 'font-medium text-cloistr-light'
                    : 'text-cloistr-light/60'
                }`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="rounded p-1.5 text-cloistr-light/60 hover:bg-cloistr-light/10 hover:text-cloistr-light"
            title="Refresh"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
          <button
            onClick={() => setShowNewFolderInput(true)}
            className="rounded p-1.5 text-cloistr-light/60 hover:bg-cloistr-light/10 hover:text-cloistr-light"
            title="New folder"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
              />
            </svg>
          </button>
          {showUpload && (
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-1.5 rounded-md bg-cloistr-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-cloistr-primary/90"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
              Upload
            </button>
          )}
        </div>
      </div>

      {/* New folder input */}
      {showNewFolderInput && (
        <div className="mb-4 flex items-center gap-2">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            placeholder="New folder name"
            className="flex-1 rounded-md border border-cloistr-light/20 bg-cloistr-dark px-3 py-1.5 text-sm text-cloistr-light placeholder-cloistr-light/40 focus:border-cloistr-primary focus:outline-none"
            autoFocus
          />
          <button
            onClick={handleCreateFolder}
            className="rounded-md bg-cloistr-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-cloistr-primary/90"
          >
            Create
          </button>
          <button
            onClick={() => {
              setShowNewFolderInput(false);
              setNewFolderName('');
            }}
            className="rounded-md border border-cloistr-light/20 px-3 py-1.5 text-sm text-cloistr-light/60 hover:bg-cloistr-light/5"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Quota bar */}
      {quota && (
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-xs text-cloistr-light/60">
            <span>{quota.usedHuman} used</span>
            <span>{quota.limitHuman}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-cloistr-light/10">
            <div
              className={`h-full transition-all ${quota.percent > 90 ? 'bg-red-500' : 'bg-cloistr-primary'}`}
              style={{ width: `${Math.min(quota.percent, 100)}%` }}
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

      {/* Loading state */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cloistr-light/20 border-t-cloistr-primary" />
        </div>
      ) : (
        /* File/folder list */
        <div className="flex-1 overflow-auto">
          {folders.length === 0 && files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg
                className="mb-4 h-16 w-16 text-cloistr-light/20"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              <p className="text-cloistr-light/60">This folder is empty</p>
              <p className="mt-1 text-sm text-cloistr-light/60">
                Upload files or create folders to get started
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {/* Folders */}
              {folders.map((folder) => (
                <div
                  key={folder.id}
                  className={`group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-cloistr-light/5 ${
                    selectedItem === `folder:${folder.id}` ? 'bg-cloistr-light/10' : ''
                  }`}
                  onClick={() => handleFolderClick(folder)}
                >
                  <span className="text-xl">📁</span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-cloistr-light">{folder.name}</p>
                    <p className="text-xs text-cloistr-light/60">{formatDate(folder.createdAt)}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFolder(folder);
                    }}
                    className="rounded p-1 text-cloistr-light/40 opacity-0 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              ))}

              {/* Files */}
              {files.map((file) => (
                <div
                  key={file.sha256}
                  className={`group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-cloistr-light/5 ${
                    selectedItem === `file:${file.sha256}` ? 'bg-cloistr-light/10' : ''
                  }`}
                  onClick={() => handleFileClick(file)}
                >
                  <span className="text-xl">{getFileIcon(file.mimeType)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-cloistr-light">{file.name}</p>
                    <p className="text-xs text-cloistr-light/60">
                      {formatSize(file.size)} • {formatDate(file.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(file);
                      }}
                      className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
                      title="Download"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                    </button>
                    {onShare && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onShare(file);
                        }}
                        className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
                        title="Share"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                          />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFile(file);
                      }}
                      className="rounded p-1 text-cloistr-light/40 hover:bg-red-500/10 hover:text-red-400"
                      title="Delete"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Upload modal */}
      <FileUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUploadComplete={() => refresh()}
      />
    </div>
  );
}
