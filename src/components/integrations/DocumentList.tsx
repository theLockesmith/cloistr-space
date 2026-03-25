/**
 * @fileoverview Document list component
 * Browse and manage collaborative documents
 */

import { useState, useCallback } from 'react';
import { useDocs, getDocs } from '@/services/cloistr';
import type { Doc } from '@/types/docs';

interface DocumentListProps {
  /** Called when opening a document */
  onOpenDocument?: (doc: Doc) => void;
}

export function DocumentList({ onOpenDocument }: DocumentListProps) {
  const {
    documents,
    total,
    page,
    isLoading,
    error,
    nextPage,
    prevPage,
    createDocument,
    deleteDocument,
    refresh,
  } = useDocs();

  const [showNewDocInput, setShowNewDocInput] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocDescription, setNewDocDescription] = useState('');

  const handleCreateDocument = useCallback(async () => {
    if (!newDocTitle.trim()) return;

    const doc = await createDocument(newDocTitle.trim(), newDocDescription.trim() || undefined);
    if (doc) {
      setNewDocTitle('');
      setNewDocDescription('');
      setShowNewDocInput(false);
    }
  }, [newDocTitle, newDocDescription, createDocument]);

  const handleDeleteDocument = useCallback(async (doc: Doc) => {
    if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    await deleteDocument(doc.id);
  }, [deleteDocument]);

  const handleOpenInEditor = useCallback((doc: Doc) => {
    const docs = getDocs();
    const editorUrl = docs.getEditorUrl(doc.id);
    window.open(editorUrl, '_blank');
  }, []);

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString();
  };

  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-cloistr-light">Documents</h2>
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
            onClick={() => setShowNewDocInput(true)}
            className="flex items-center gap-1.5 rounded-md bg-cloistr-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-cloistr-primary/90"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            New
          </button>
        </div>
      </div>

      {/* New document form */}
      {showNewDocInput && (
        <div className="mb-4 space-y-2 rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4">
          <input
            type="text"
            value={newDocTitle}
            onChange={(e) => setNewDocTitle(e.target.value)}
            placeholder="Document title"
            className="w-full rounded-md border border-cloistr-light/20 bg-cloistr-dark px-3 py-2 text-sm text-cloistr-light placeholder-cloistr-light/40 focus:border-cloistr-primary focus:outline-none"
            autoFocus
          />
          <input
            type="text"
            value={newDocDescription}
            onChange={(e) => setNewDocDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded-md border border-cloistr-light/20 bg-cloistr-dark px-3 py-2 text-sm text-cloistr-light placeholder-cloistr-light/40 focus:border-cloistr-primary focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setShowNewDocInput(false);
                setNewDocTitle('');
                setNewDocDescription('');
              }}
              className="rounded-md border border-cloistr-light/20 px-3 py-1.5 text-sm text-cloistr-light/60 hover:bg-cloistr-light/5"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateDocument}
              disabled={!newDocTitle.trim()}
              className="rounded-md bg-cloistr-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-cloistr-primary/90 disabled:opacity-50"
            >
              Create
            </button>
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
        /* Document list */
        <div className="flex-1 overflow-auto">
          {documents.length === 0 ? (
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
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="text-cloistr-light/60">No documents yet</p>
              <p className="mt-1 text-sm text-cloistr-light/40">
                Create a new document to get started
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-cloistr-light/5"
                  onClick={() => onOpenDocument?.(doc)}
                >
                  <span className="text-xl">📝</span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-cloistr-light">{doc.title}</p>
                    <p className="text-xs text-cloistr-light/40">
                      {doc.description || `Updated ${formatDate(doc.updatedAt)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenInEditor(doc);
                      }}
                      className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light"
                      title="Open in editor"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDocument(doc);
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between border-t border-cloistr-light/10 pt-4">
          <button
            onClick={prevPage}
            disabled={page === 1}
            className="rounded-md border border-cloistr-light/20 px-3 py-1.5 text-sm text-cloistr-light/60 hover:bg-cloistr-light/5 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-cloistr-light/40">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={nextPage}
            disabled={page === totalPages}
            className="rounded-md border border-cloistr-light/20 px-3 py-1.5 text-sm text-cloistr-light/60 hover:bg-cloistr-light/5 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
