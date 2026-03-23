/**
 * @fileoverview NDK service for Nostr relay connections
 * Provides relay pool initialization, connection management, and event publishing
 */

import NDK, {
  NDKEvent,
  NDKRelaySet,
  NDKSigner,
  NDKUser,
  type NDKFilter,
  type NDKRelay,
  type NostrEvent,
} from '@nostr-dev-kit/ndk';
import type { UnsignedEvent } from 'nostr-tools';
import type { SignerInterface } from '@cloistr/collab-common/auth';
import { defaultRelays } from '@/config/environment';

/**
 * Relay connection status for UI
 */
export interface RelayStatus {
  url: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string;
}

/**
 * NDK service configuration
 */
export interface NdkServiceConfig {
  explicitRelayUrls?: string[];
  autoConnect?: boolean;
  debug?: boolean;
}

/**
 * Adapter that wraps SignerInterface for NDK compatibility
 * NDK requires its own signer interface, this bridges the gap
 */
export class SignerAdapter implements NDKSigner {
  private readonly signer: SignerInterface;
  private cachedUser: NDKUser | null = null;
  private cachedPubkey: string | null = null;

  constructor(signer: SignerInterface) {
    this.signer = signer;
  }

  /**
   * Synchronous pubkey getter - throws if not ready
   */
  get pubkey(): string {
    if (!this.cachedPubkey) {
      throw new Error('Signer not ready - call blockUntilReady() first');
    }
    return this.cachedPubkey;
  }

  /**
   * Synchronous user getter - throws if not ready
   */
  get userSync(): NDKUser {
    if (!this.cachedUser) {
      throw new Error('Signer not ready - call blockUntilReady() first');
    }
    return this.cachedUser;
  }

  async blockUntilReady(): Promise<NDKUser> {
    if (this.cachedUser && this.cachedPubkey) {
      return this.cachedUser;
    }
    this.cachedPubkey = await this.signer.getPublicKey();
    this.cachedUser = new NDKUser({ pubkey: this.cachedPubkey });
    return this.cachedUser;
  }

  async user(): Promise<NDKUser> {
    return this.blockUntilReady();
  }

  async sign(event: NostrEvent): Promise<string> {
    // Convert NostrEvent to UnsignedEvent format
    const unsigned: UnsignedEvent = {
      kind: event.kind!,
      created_at: event.created_at,
      tags: event.tags as string[][],
      content: event.content,
      pubkey: event.pubkey,
    };

    const signed = await this.signer.signEvent(unsigned);
    return signed.sig;
  }

  async encrypt(recipient: NDKUser, value: string): Promise<string> {
    // Note: NDK's encrypt has optional scheme parameter, we only support nip04
    return this.signer.encrypt(recipient.pubkey, value);
  }

  async decrypt(sender: NDKUser, value: string): Promise<string> {
    // Note: NDK's decrypt has optional scheme parameter, we only support nip04
    return this.signer.decrypt(sender.pubkey, value);
  }

  /**
   * Serialize signer data for storage
   * We don't support full serialization since the underlying signer
   * handles session persistence
   */
  toPayload(): string {
    return JSON.stringify({
      type: 'cloistr-adapter',
      pubkey: this.cachedPubkey,
    });
  }
}

/**
 * NDK service singleton for managing Nostr connections
 */
export class NdkService {
  private ndk: NDK;
  private statusListeners: Set<(statuses: Map<string, RelayStatus>) => void> = new Set();
  private relayStatuses: Map<string, RelayStatus> = new Map();
  private isConnecting = false;
  private isConnected = false;

  constructor(config: NdkServiceConfig = {}) {
    const relayUrls = config.explicitRelayUrls ?? [...defaultRelays];

    this.ndk = new NDK({
      explicitRelayUrls: relayUrls,
      autoConnectUserRelays: false, // Manual control
      enableOutboxModel: false, // Start simple, enable later
    });

    // Initialize relay statuses
    for (const url of relayUrls) {
      this.relayStatuses.set(url, { url, status: 'disconnected' });
    }

    // Set up relay event listeners
    this.setupRelayListeners();

    if (config.autoConnect) {
      this.connect();
    }
  }

  private setupRelayListeners(): void {
    this.ndk.pool.on('relay:connect', (relay: NDKRelay) => {
      this.updateRelayStatus(relay.url, 'connected');
    });

    this.ndk.pool.on('relay:disconnect', (relay: NDKRelay) => {
      this.updateRelayStatus(relay.url, 'disconnected');
    });

    // Handle connection errors via notice
    this.ndk.pool.on('notice', (relay: NDKRelay, notice: string) => {
      console.warn(`[NDK] Relay notice from ${relay.url}:`, notice);
    });
  }

  private updateRelayStatus(
    url: string,
    status: RelayStatus['status'],
    error?: string
  ): void {
    this.relayStatuses.set(url, { url, status, error });
    this.notifyStatusListeners();
  }

  private notifyStatusListeners(): void {
    for (const listener of this.statusListeners) {
      listener(new Map(this.relayStatuses));
    }
  }

  /**
   * Connect to all configured relays
   */
  async connect(): Promise<void> {
    if (this.isConnecting || this.isConnected) {
      return;
    }

    this.isConnecting = true;

    // Mark all as connecting
    for (const [url] of this.relayStatuses) {
      this.updateRelayStatus(url, 'connecting');
    }

    try {
      await this.ndk.connect();
      this.isConnected = true;
    } catch (error) {
      console.error('[NDK] Connection error:', error);
      // Individual relay errors handled by listeners
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Disconnect from all relays
   */
  disconnect(): void {
    for (const relay of this.ndk.pool.relays.values()) {
      relay.disconnect();
    }
    this.isConnected = false;

    for (const [url] of this.relayStatuses) {
      this.updateRelayStatus(url, 'disconnected');
    }
  }

  /**
   * Set the signer for event signing
   */
  setSigner(signer: SignerInterface | null): void {
    if (signer) {
      this.ndk.signer = new SignerAdapter(signer);
    } else {
      this.ndk.signer = undefined;
    }
  }

  /**
   * Get the underlying NDK instance for advanced usage
   */
  getNdk(): NDK {
    return this.ndk;
  }

  /**
   * Subscribe to relay status changes
   */
  onStatusChange(listener: (statuses: Map<string, RelayStatus>) => void): () => void {
    this.statusListeners.add(listener);
    // Immediately notify with current status
    listener(new Map(this.relayStatuses));

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Get current relay statuses
   */
  getRelayStatuses(): Map<string, RelayStatus> {
    return new Map(this.relayStatuses);
  }

  /**
   * Check if any relay is connected
   */
  hasConnection(): boolean {
    for (const status of this.relayStatuses.values()) {
      if (status.status === 'connected') {
        return true;
      }
    }
    return false;
  }

  /**
   * Fetch events matching filters
   */
  async fetchEvents(filters: NDKFilter | NDKFilter[]): Promise<Set<NDKEvent>> {
    const filterArray = Array.isArray(filters) ? filters : [filters];
    return this.ndk.fetchEvents(filterArray);
  }

  /**
   * Subscribe to events matching filters
   */
  subscribe(
    filters: NDKFilter | NDKFilter[],
    opts?: {
      closeOnEose?: boolean;
      groupable?: boolean;
    }
  ) {
    const filterArray = Array.isArray(filters) ? filters : [filters];
    return this.ndk.subscribe(filterArray, opts);
  }

  /**
   * Publish an event to relays
   */
  async publish(event: NDKEvent, relaySet?: NDKRelaySet): Promise<Set<NDKRelay>> {
    return event.publish(relaySet);
  }

  /**
   * Create a new NDK event
   */
  createEvent(): NDKEvent {
    return new NDKEvent(this.ndk);
  }

  /**
   * Create an NDKUser from pubkey
   */
  getUser(pubkey: string): NDKUser {
    return new NDKUser({ pubkey });
  }
}

// Export NDK types for convenience
export { NDKEvent, NDKRelaySet, NDKUser, type NDKFilter };
