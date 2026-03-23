// NIP-0A CRDT Contact Types

export interface Contact {
  pubkey: string;
  relay?: string;
  petname?: string;
  timestamp: number;
  nip05?: string;
  name?: string;
  picture?: string;
  about?: string;
  trustScore?: number;
  isFollowing: boolean;
  isFollowedBy: boolean;
}

export interface ContactEntry {
  pubkey: string;
  relay?: string;
  petname?: string;
  timestamp: number;
  deleted: boolean;
}

export interface ContactsCrdtState {
  entries: Map<string, ContactEntry>;
  version: number;
  lastSync: number;
  clientId: string;
  pendingChanges: ContactEntry[];
}

export interface ConflictResolution {
  pubkey: string;
  localTimestamp: number;
  remoteTimestamp: number;
  winner: 'local' | 'remote';
  resolvedAt: Date;
}

export interface ContactsFilter {
  search?: string;
  minTrustScore?: number;
  onlyMutual?: boolean;
  sortBy: 'name' | 'trustScore' | 'lastSeen';
  sortOrder: 'asc' | 'desc';
}
