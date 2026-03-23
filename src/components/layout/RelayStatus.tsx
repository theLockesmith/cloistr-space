/**
 * @fileoverview Relay connection status components
 * Shows live relay connection status from NDK
 */

import { useState } from 'react';
import { useNdk, type RelayStatus as RelayStatusType } from '@/services/nostr';

/**
 * Compact relay status indicator (for sidebar)
 */
export function RelayStatusCompact() {
  const { relayStatuses, isConnected, isConnecting, reconnect } = useNdk();

  const connectedCount = Array.from(relayStatuses.values()).filter(
    (s) => s.status === 'connected'
  ).length;
  const totalCount = relayStatuses.size;

  const statusColor = isConnecting
    ? 'bg-yellow-400 animate-pulse'
    : isConnected
    ? 'bg-green-400'
    : 'bg-red-400';

  const statusText = isConnecting
    ? 'Connecting...'
    : isConnected
    ? `${connectedCount}/${totalCount}`
    : 'Offline';

  return (
    <button
      onClick={reconnect}
      className="flex items-center justify-between text-xs w-full group"
      title={isConnecting ? 'Connecting to relays...' : `Click to reconnect (${connectedCount}/${totalCount} relays)`}
    >
      <span className="text-cloistr-light/60 group-hover:text-cloistr-light">
        Relays
      </span>
      <span className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${statusColor}`} />
        <span className={isConnected ? 'text-green-400' : isConnecting ? 'text-yellow-400' : 'text-red-400'}>
          {statusText}
        </span>
      </span>
    </button>
  );
}

/**
 * Dot indicator for collapsed sidebar
 */
export function RelayStatusDot() {
  const { isConnected, isConnecting } = useNdk();

  const statusColor = isConnecting
    ? 'bg-yellow-400 animate-pulse'
    : isConnected
    ? 'bg-green-400'
    : 'bg-red-400';

  return (
    <div
      className={`h-2 w-2 rounded-full ${statusColor}`}
      title={isConnecting ? 'Connecting...' : isConnected ? 'Relays connected' : 'Relays offline'}
    />
  );
}

/**
 * Expanded relay status panel
 */
export function RelayStatusPanel({ onClose }: { onClose?: () => void }) {
  const { relayStatuses, isConnecting, reconnect } = useNdk();
  const [showDetails, setShowDetails] = useState(false);

  const connectedCount = Array.from(relayStatuses.values()).filter(
    (s) => s.status === 'connected'
  ).length;

  return (
    <div className="rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-cloistr-light">Relay Status</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-cloistr-light/60 hover:text-cloistr-light"
          >
            {showDetails ? 'Hide' : 'Details'}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-cloistr-light/40 hover:text-cloistr-light"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-cloistr-light/10">
        <div className="flex items-center gap-2">
          <StatusIndicator
            status={connectedCount > 0 ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}
          />
          <span className="text-sm text-cloistr-light">
            {connectedCount} of {relayStatuses.size} connected
          </span>
        </div>
        <button
          onClick={reconnect}
          disabled={isConnecting}
          className="rounded px-2 py-1 text-xs bg-cloistr-primary/20 text-cloistr-primary hover:bg-cloistr-primary/30 disabled:opacity-50"
        >
          {isConnecting ? 'Connecting...' : 'Reconnect'}
        </button>
      </div>

      {/* Relay list */}
      {showDetails && (
        <div className="space-y-2">
          {Array.from(relayStatuses.values()).map((relay) => (
            <RelayItem key={relay.url} relay={relay} />
          ))}
        </div>
      )}
    </div>
  );
}

function RelayItem({ relay }: { relay: RelayStatusType }) {
  const hostname = new URL(relay.url).hostname;

  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2 min-w-0">
        <StatusIndicator status={relay.status} />
        <span className="text-xs text-cloistr-light/80 truncate" title={relay.url}>
          {hostname}
        </span>
      </div>
      <span className="text-xs text-cloistr-light/40 capitalize">
        {relay.status}
      </span>
    </div>
  );
}

function StatusIndicator({ status }: { status: RelayStatusType['status'] }) {
  const colors: Record<RelayStatusType['status'], string> = {
    connected: 'bg-green-400',
    connecting: 'bg-yellow-400 animate-pulse',
    disconnected: 'bg-gray-400',
    error: 'bg-red-400',
  };

  return <span className={`h-2 w-2 rounded-full ${colors[status]}`} />;
}
