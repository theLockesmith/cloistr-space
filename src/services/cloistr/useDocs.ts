/**
 * @fileoverview Docs hook
 * List and manage documents
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getDocs } from './docs';
import type { Doc, DocDetail } from '@/types/docs';

interface UseDocsOptions {
  /** Auto-fetch on mount */
  autoFetch?: boolean;
  /** Page size */
  pageSize?: number;
}

interface UseDocsReturn {
  /** List of documents */
  documents: Doc[];
  /** Total document count */
  total: number;
  /** Current page */
  page: number;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Load next page */
  nextPage: () => void;
  /** Load previous page */
  prevPage: () => void;
  /** Go to specific page */
  goToPage: (page: number) => void;
  /** Create a new document */
  createDocument: (title: string, description?: string) => Promise<Doc | null>;
  /** Delete a document */
  deleteDocument: (id: string) => Promise<boolean>;
  /** Get document details */
  getDocument: (id: string) => Promise<DocDetail | null>;
  /** Refresh document list */
  refresh: () => void;
}

/**
 * Hook for listing and managing documents
 */
export function useDocs(options: UseDocsOptions = {}): UseDocsReturn {
  const { autoFetch = true, pageSize = 20 } = options;
  const { pubkey, isAuthenticated } = useAuth();

  const [documents, setDocuments] = useState<Doc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Configure auth when available
  useEffect(() => {
    const docs = getDocs();
    docs.setAuth(pubkey);
  }, [pubkey]);

  // Fetch documents
  const fetchDocuments = useCallback(async () => {
    if (!pubkey) {
      setDocuments([]);
      setTotal(0);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const docs = getDocs();
      const result = await docs.listDocuments(page, pageSize);
      setDocuments(result.documents);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  }, [pubkey, page, pageSize]);

  // Auto-fetch on mount and when dependencies change
  useEffect(() => {
    if (autoFetch && isAuthenticated) {
      fetchDocuments();
    }
  }, [autoFetch, isAuthenticated, fetchDocuments, refreshKey]);

  const nextPage = useCallback(() => {
    const maxPage = Math.ceil(total / pageSize);
    if (page < maxPage) {
      setPage((p) => p + 1);
    }
  }, [page, total, pageSize]);

  const prevPage = useCallback(() => {
    if (page > 1) {
      setPage((p) => p - 1);
    }
  }, [page]);

  const goToPage = useCallback((newPage: number) => {
    const maxPage = Math.ceil(total / pageSize);
    if (newPage >= 1 && newPage <= maxPage) {
      setPage(newPage);
    }
  }, [total, pageSize]);

  const createDocumentFn = useCallback(async (title: string, description?: string): Promise<Doc | null> => {
    if (!pubkey) {
      setError('Not authenticated');
      return null;
    }

    try {
      const docs = getDocs();
      const doc = await docs.createDocument(title, description);
      setRefreshKey((k) => k + 1);
      return doc;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create document');
      return null;
    }
  }, [pubkey]);

  const deleteDocumentFn = useCallback(async (id: string): Promise<boolean> => {
    if (!pubkey) {
      setError('Not authenticated');
      return false;
    }

    try {
      const docs = getDocs();
      await docs.deleteDocument(id);
      setRefreshKey((k) => k + 1);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document');
      return false;
    }
  }, [pubkey]);

  const getDocumentFn = useCallback(async (id: string): Promise<DocDetail | null> => {
    try {
      const docs = getDocs();
      return await docs.getDocument(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get document');
      return null;
    }
  }, []);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return useMemo(() => ({
    documents,
    total,
    page,
    isLoading,
    error,
    nextPage,
    prevPage,
    goToPage,
    createDocument: createDocumentFn,
    deleteDocument: deleteDocumentFn,
    getDocument: getDocumentFn,
    refresh,
  }), [
    documents,
    total,
    page,
    isLoading,
    error,
    nextPage,
    prevPage,
    goToPage,
    createDocumentFn,
    deleteDocumentFn,
    getDocumentFn,
    refresh,
  ]);
}
