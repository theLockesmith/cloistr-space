/**
 * @fileoverview Conflict resolution panel for contact list syncs
 * Shows recent conflicts and their resolutions
 */

import { useState } from 'react';
import { useContactsStore } from '@/stores/contactsStore';
import type { ConflictResolution } from '@/types/contacts';

interface ConflictResolutionPanelProps {
  /** Maximum conflicts to show */
  maxDisplay?: number;
}

export function ConflictResolutionPanel({ maxDisplay = 5 }: ConflictResolutionPanelProps) {
  const { conflictLog } = useContactsStore();
  const [expanded, setExpanded] = useState(false);

  // No conflicts, don't render
  if (conflictLog.length === 0) {
    return null;
  }

  // Get recent conflicts (newest first)
  const recentConflicts = [...conflictLog]
    .sort((a, b) => b.resolvedAt.getTime() - a.resolvedAt.getTime())
    .slice(0, expanded ? conflictLog.length : maxDisplay);

  const hasMore = conflictLog.length > maxDisplay;

  return (
    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-yellow-500/20 p-1.5">
            <svg className="h-4 w-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-cloistr-light">
            Sync Conflicts Resolved
          </h3>
          <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-500">
            {conflictLog.length}
          </span>
        </div>
      </div>

      <p className="text-xs text-cloistr-light/60 mb-3">
        Contact list conflicts were automatically resolved using timestamps.
        The most recent change always wins.
      </p>

      <div className="space-y-2">
        {recentConflicts.map((conflict, idx) => (
          <ConflictItem key={`${conflict.pubkey}-${idx}`} conflict={conflict} />
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 text-xs text-cloistr-primary hover:text-cloistr-primary/80"
        >
          {expanded ? 'Show less' : `Show ${conflictLog.length - maxDisplay} more`}
        </button>
      )}
    </div>
  );
}

function ConflictItem({ conflict }: { conflict: ConflictResolution }) {
  const shortPubkey = `${conflict.pubkey.slice(0, 8)}...${conflict.pubkey.slice(-4)}`;
  const localTime = new Date(conflict.localTimestamp * 1000).toLocaleString();
  const remoteTime = new Date(conflict.remoteTimestamp * 1000).toLocaleString();

  return (
    <div className="rounded bg-cloistr-dark/50 p-2 text-xs">
      <div className="flex items-center justify-between">
        <code className="text-cloistr-light/80">{shortPubkey}</code>
        <span className={`rounded px-1.5 py-0.5 ${
          conflict.winner === 'local'
            ? 'bg-green-500/20 text-green-400'
            : 'bg-blue-500/20 text-blue-400'
        }`}>
          {conflict.winner === 'local' ? 'Local won' : 'Remote won'}
        </span>
      </div>
      <div className="mt-1 text-cloistr-light/40 grid grid-cols-2 gap-2">
        <div>
          <span className="text-cloistr-light/60">Local:</span> {localTime}
        </div>
        <div>
          <span className="text-cloistr-light/60">Remote:</span> {remoteTime}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact conflict indicator for use in headers/status bars
 */
export function ConflictIndicator() {
  const { conflictLog } = useContactsStore();
  const [showPanel, setShowPanel] = useState(false);

  if (conflictLog.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-yellow-500 hover:bg-yellow-500/10"
        title={`${conflictLog.length} sync conflicts resolved`}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span>{conflictLog.length}</span>
      </button>

      {showPanel && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowPanel(false)}
          />
          {/* Panel */}
          <div className="absolute right-0 top-full z-50 mt-2 w-80">
            <ConflictResolutionPanel maxDisplay={3} />
          </div>
        </>
      )}
    </div>
  );
}
