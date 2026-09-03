/**
 * @fileoverview Drive hook
 * Browse files and folders from Drive API
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getDrive } from './drive';
import type { DriveFile, DriveFolder, StorageQuota, Breadcrumb } from '@/types/drive';

interface UseDriveOptions {
  /** Initial folder ID (empty string = root) */
  initialFolder?: string;
  /** Auto-fetch on mount */
  autoFetch?: boolean;
}

interface UseDriveReturn {
  /** Current folder ID */
  currentFolder: string;
  /** Files in current folder */
  files: DriveFile[];
  /** Subfolders in current folder */
  folders: DriveFolder[];
  /** Breadcrumb navigation path */
  breadcrumbs: Breadcrumb[];
  /** Storage quota */
  quota: StorageQuota | null;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Navigate to folder */
  navigateTo: (folderId: string) => void;
  /** Navigate up one level */
  navigateUp: () => void;
  /** Create a new folder */
  createFolder: (name: string) => Promise<DriveFolder | null>;
  /** Delete a file */
  deleteFile: (sha256: string) => Promise<boolean>;
  /** Delete a folder */
  deleteFolder: (folderId: string) => Promise<boolean>;
  /** Refresh current view */
  refresh: () => void;
}

/**
 * Hook for browsing Drive files and folders
 */
export function useDrive(options: UseDriveOptions = {}): UseDriveReturn {
  const { initialFolder = '', autoFetch = true } = options;
  const { pubkey, isAuthenticated, signer } = useAuth();

  const [currentFolder, setCurrentFolder] = useState(initialFolder);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [quota, setQuota] = useState<StorageQuota | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Configure signer when available
  useEffect(() => {
    const drive = getDrive();
    if (signer && isAuthenticated) {
      drive.setSigner(signer);
    } else {
      drive.setSigner(null);
    }
  }, [signer, isAuthenticated]);

  // Build breadcrumb path. Declared before fetchData (which calls it) so
  // fetchData can list it in its own dependency array below without a
  // temporal-dead-zone reference to a not-yet-initialized const.
  const buildBreadcrumbs = useCallback(async (folderId: string, userPubkey: string) => {
    const crumbs: Breadcrumb[] = [{ id: '', name: 'My Drive' }];

    if (!folderId) {
      setBreadcrumbs(crumbs);
      return;
    }

    const drive = getDrive();
    let currentId = folderId;

    // Walk up the folder tree
    while (currentId) {
      const folder = await drive.getFolder(currentId, userPubkey);
      if (!folder) break;

      crumbs.splice(1, 0, { id: folder.id, name: folder.name });
      currentId = folder.parentId;
    }

    setBreadcrumbs(crumbs);
  }, []);

  // Fetch files and folders.
  //
  // Promise-chained rather than async/await: every setState call needs to run
  // from inside a .then()/.catch()/.finally() callback, not synchronously in
  // fetchData's own body -- react-hooks/set-state-in-effect flags a setState
  // reachable synchronously from the effect below even when it is behind an
  // await, since statically that is indistinguishable from an unconditional
  // render-triggering update. buildBreadcrumbs can keep its own async/await
  // internally: it is only invoked from within a .then() callback here, which
  // is a separate function the effect never calls directly.
  const fetchData = useCallback(() => {
    if (!pubkey) {
      return Promise.resolve().then(() => {
        setFiles([]);
        setFolders([]);
        setQuota(null);
      });
    }

    return Promise.resolve()
      .then(() => {
        setIsLoading(true);
        setError(null);
      })
      .then(() => {
        const drive = getDrive();
        // Fetch files, folders, and quota in parallel
        return Promise.all([
          drive.listFiles(pubkey, currentFolder),
          drive.listFolders(pubkey, currentFolder),
          drive.getQuota(pubkey),
        ]);
      })
      .then(([filesResult, foldersResult, quotaResult]) => {
        setFiles(filesResult);
        setFolders(foldersResult);
        setQuota(quotaResult);

        // Build breadcrumbs
        return buildBreadcrumbs(currentFolder, pubkey);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load files');
      })
      .finally(() => setIsLoading(false));
  }, [pubkey, currentFolder, buildBreadcrumbs]);

  // Auto-fetch on mount and when folder changes
  useEffect(() => {
    if (autoFetch && isAuthenticated) {
      fetchData();
    }
  }, [autoFetch, isAuthenticated, fetchData, refreshKey]);

  const navigateTo = useCallback((folderId: string) => {
    setCurrentFolder(folderId);
  }, []);

  const navigateUp = useCallback(() => {
    if (breadcrumbs.length > 1) {
      const parentIndex = breadcrumbs.length - 2;
      setCurrentFolder(breadcrumbs[parentIndex].id);
    }
  }, [breadcrumbs]);

  const createFolderFn = useCallback(async (name: string): Promise<DriveFolder | null> => {
    if (!signer) {
      setError('Not authenticated');
      return null;
    }

    try {
      const drive = getDrive();
      const folder = await drive.createFolder(name, currentFolder);
      setRefreshKey((k) => k + 1);
      return folder;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder');
      return null;
    }
  }, [signer, currentFolder]);

  const deleteFileFn = useCallback(async (sha256: string): Promise<boolean> => {
    if (!signer) {
      setError('Not authenticated');
      return false;
    }

    try {
      const drive = getDrive();
      await drive.deleteFile(sha256);
      setRefreshKey((k) => k + 1);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete file');
      return false;
    }
  }, [signer]);

  const deleteFolderFn = useCallback(async (folderId: string): Promise<boolean> => {
    if (!signer) {
      setError('Not authenticated');
      return false;
    }

    try {
      const drive = getDrive();
      await drive.deleteFolder(folderId);
      setRefreshKey((k) => k + 1);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete folder');
      return false;
    }
  }, [signer]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return useMemo(() => ({
    currentFolder,
    files,
    folders,
    breadcrumbs,
    quota,
    isLoading,
    error,
    navigateTo,
    navigateUp,
    createFolder: createFolderFn,
    deleteFile: deleteFileFn,
    deleteFolder: deleteFolderFn,
    refresh,
  }), [
    currentFolder,
    files,
    folders,
    breadcrumbs,
    quota,
    isLoading,
    error,
    navigateTo,
    navigateUp,
    createFolderFn,
    deleteFileFn,
    deleteFolderFn,
    refresh,
  ]);
}
