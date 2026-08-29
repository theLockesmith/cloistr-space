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
import type { SignerInterface } from '@cloistr/auth';
import { defaultRelays } from '@/config/environment';
import { RelayAuthPolicy } from './authPolicy';

/**
 * Relay connection status for UI
 */
export interface RelayStatus {
  url: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string;
  /**
   * True for relays we asked for, false for ones the outbox model found on its
   * own while resolving a followed author's relay list.
   *
   * Before outbox, discovered relays were dropped from tracking entirely, which
   * was fine when the pool only ever held what we configured. It is not fine now:
   * most connections are discovered, so dropping them made the status UI report
   * a number with no relationship to how many sockets are actually open.
   */
  configured: boolean;
}

/**
 * NDK service configuration
 */
export interface NdkServiceConfig {
  explicitRelayUrls?: string[];
  autoConnect?: boolean;
  debug?: boolean;
  /**
   * Authenticate to relays beyond the user's own set. Defaults to true.
   * Backs the single user-facing setting described in ded5c8fc.
   */
  relayAuthEnabled?: boolean;
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
  private configuredRelays: Set<string>;
  private isConnecting = false;
  private isConnected = false;
  private readonly authPolicy: RelayAuthPolicy;

  constructor(config: NdkServiceConfig = {}) {
    const relayUrls = config.explicitRelayUrls ?? [...defaultRelays];

    // Relays we asked for, as opposed to ones outbox resolution turns up later.
    // Normalize URLs to handle trailing slash inconsistencies.
    this.configuredRelays = new Set(relayUrls.map((url) => NdkService.normalizeUrl(url)));

    // These are the user's own relays, so they are tier 1: always authenticated.
    // Anything the outbox model discovers later is not, and has to earn a
    // signature by having an open subscription. See authPolicy.ts.
    this.authPolicy = new RelayAuthPolicy(relayUrls, config.relayAuthEnabled ?? true);

    this.ndk = new NDK({
      explicitRelayUrls: relayUrls,
      // Both of these default to true in NDK and were turned off during the
      // Phase 1 scaffold (c9fb26b) with a note to enable them later. Leaving
      // them off meant every feed query went to explicitRelayUrls only, so a
      // following feed asked one relay for events written to relays it does not
      // carry -- see useFeed.ts, which builds a single authors[] filter.
      // Outbox resolves each author's own write relays instead.
      autoConnectUserRelays: true,
      enableOutboxModel: true,
      relayAuthDefaultPolicy: this.authPolicy.policy,
    });

    // Initialize relay statuses
    for (const url of relayUrls) {
      const normalized = NdkService.normalizeUrl(url);
      this.relayStatuses.set(normalized, {
        url: normalized,
        status: 'disconnected',
        configured: true,
      });
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

  private static normalizeUrl(url: string): string {
    // Remove trailing slash for consistent comparison
    return url.replace(/\/+$/, '');
  }

  private updateRelayStatus(
    url: string,
    status: RelayStatus['status'],
    error?: string
  ): void {
    // Normalize URL for consistent comparison (NDK may add trailing slash)
    const normalizedUrl = NdkService.normalizeUrl(url);

    // Track discovered relays too, flagged so the UI can tell them apart. They
    // used to be dropped here, which was harmless when the pool only held what
    // we configured and actively misleading once outbox started adding to it.
    this.relayStatuses.set(normalizedUrl, {
      url: normalizedUrl,
      status,
      error,
      configured: this.configuredRelays.has(normalizedUrl),
    });
    this.notifyStatusListeners();
  }

  /**
   * Relay auth policy, for callers that need to update it after construction:
   * `setTrustedRelays` on login or key switch, `setEnabled` from the user
   * setting, `addTrustedRelay` when joining a NIP-29 group.
   */
  getAuthPolicy(): RelayAuthPolicy {
    return this.authPolicy;
  }

  /**
   * Replace the configured relay set.
   *
   * Used once relay preferences resolve (kind:30078 cloistr-relays, falling back
   * to kind:10002), which happens after construction because it needs a pubkey.
   * Updates tier 1 to match, since the user's own relays are exactly the set
   * that should always be authenticated.
   *
   * Does not reconnect on its own -- NDK keeps existing sockets and the caller
   * decides whether a reconnect is warranted.
   */
  setConfiguredRelays(urls: string[]): void {
    this.configuredRelays = new Set(urls.map((url) => NdkService.normalizeUrl(url)));
    this.authPolicy.setTrustedRelays(urls);

    for (const url of urls) {
      const normalized = NdkService.normalizeUrl(url);
      if (!this.relayStatuses.has(normalized)) {
        this.relayStatuses.set(normalized, {
          url: normalized,
          status: 'disconnected',
          configured: true,
        });
      }
    }

    // Re-flag existing entries: a relay can move between configured and
    // discovered when the user edits their relay list.
    for (const [url, status] of this.relayStatuses) {
      this.relayStatuses.set(url, {
        ...status,
        configured: this.configuredRelays.has(url),
      });
    }

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
      const adapter = new SignerAdapter(signer);
      this.ndk.signer = adapter;
      // Emit signer:ready for any pending auth flows
      this.ndk.emit('signer:ready', adapter);
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
    },
    /**
     * Handlers registered AT SUBSCRIBE TIME. NDK auto-starts the subscription
     * inside this call, so anything attached with .on() afterwards can miss a
     * delivery that already happened -- which is only survivable for long-lived
     * streaming subscriptions. One-shot queries must pass handlers here; see
     * subscribeOnce.ts.
     */
    handlers?: {
      onEvent?: (event: NDKEvent) => void;
      onEose?: () => void;
    }
  ) {
    const filterArray = Array.isArray(filters) ? filters : [filters];
    return handlers
      ? this.ndk.subscribe(filterArray, opts, handlers)
      : this.ndk.subscribe(filterArray, opts);
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
