/**
 * @fileoverview Import contacts from kind:3 (NIP-02) card
 * Shows when user has legacy contacts available for import
 */

import { useState } from 'react';
import { useContactsSync, type ImportResult } from '@/services/crdt';

export function ImportContactsCard() {
  const { kind3Status, importFromKind3, isSyncing } = useContactsSync({ autoSync: false });
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Don't show if no kind:3 contacts available or not yet checked
  if (!kind3Status.checked || !kind3Status.available) {
    return null;
  }

  const handleImport = async () => {
    setIsImporting(true);
    setImportResult(null);

    try {
      const result = await importFromKind3();
      setImportResult(result);
    } finally {
      setIsImporting(false);
    }
  };

  const isDisabled = isImporting || isSyncing;

  return (
    <div className="rounded-lg border border-cloistr-primary/30 bg-cloistr-primary/5 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-cloistr-primary/20 p-2">
          <svg className="h-5 w-5 text-cloistr-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </div>

        <div className="flex-1">
          <h3 className="text-sm font-medium text-cloistr-light">
            Import Existing Contacts
          </h3>
          <p className="mt-1 text-xs text-cloistr-light/60">
            Found {kind3Status.count} contacts in your existing follow list.
            Import them to sync across all your devices.
          </p>

          {importResult && (
            <div className={`mt-2 rounded px-2 py-1 text-xs ${
              importResult.success
                ? 'bg-green-500/10 text-green-400'
                : 'bg-red-500/10 text-red-400'
            }`}>
              {importResult.success
                ? `Imported ${importResult.contactsImported} contacts (${importResult.contactsSkipped} already synced)`
                : importResult.error}
            </div>
          )}

          <button
            onClick={handleImport}
            disabled={isDisabled}
            className="mt-3 rounded-md bg-cloistr-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-cloistr-primary/90 disabled:opacity-50"
          >
            {isImporting ? 'Importing...' : 'Import Contacts'}
          </button>
        </div>
      </div>
    </div>
  );
}
