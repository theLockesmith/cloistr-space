/**
 * @fileoverview NDK React context provider
 * Provides NDK instance to the app with automatic signer integration
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  NdkService,
  type RelayStatus,
  type NdkServiceConfig,
  NDKEvent,
} from './ndk';

interface NdkContextValue {
  /** NDK service instance */
  service: NdkService | null;
  /** Whether NDK is connected to at least one relay */
  isConnected: boolean;
  /** Whether NDK is currently connecting */
  isConnecting: boolean;
  /** Current relay statuses */
  relayStatuses: Map<string, RelayStatus>;
  /** Manually reconnect to relays */
  reconnect: () => Promise<void>;
  /** Subscribe to events */
  subscribe: NdkService['subscribe'] | null;
  /** Fetch events */
  fetchEvents: NdkService['fetchEvents'] | null;
  /**
   * Fetch from the user's own relays only, bypassing outbox routing.
   *
   * For kinds that live on OUR relay by construction (NIP-29 groups, NIP-0A
   * contacts, calendar, tasks, file metadata). Without this, NDK routes a
   * filter carrying `authors` by the author's relay list, which can scatter
   * the query across relays that have never seen our kinds. See
   * services/nostr/relayRouting.ts for the per-kind routing manifest.
   */
  fetchFromOwnRelays: NdkService['fetchFromOwnRelays'] | null;
  /** Create a new event */
  createEvent: () => NDKEvent | null;
  /** Publish an event */
  publish: NdkService['publish'] | null;
}

const NdkContext = createContext<NdkContextValue | null>(null);

interface NdkProviderProps {
  children: ReactNode;
  config?: NdkServiceConfig;
}

export function NdkProvider({ children, config }: NdkProviderProps) {
  const { signer, isAuthenticated } = useAuth();
  const updateServiceStatus = useWorkspaceStore((s) => s.updateServiceStatus);

  const serviceRef = useRef<NdkService | null>(null);
  // Mirrors serviceRef.current for anything read during render (the `value`
  // useMemo below). Reading serviceRef.current directly inside that memo was
  // a real bug, not just a lint complaint: mutating a ref does not schedule a
  // re-render, so the memo (keyed on isConnected/relayStatuses/etc., none of
  // which necessarily change at the moment the service is constructed) could
  // keep handing consumers `service: null` / `subscribe: null` / etc.
  // indefinitely -- until some unrelated relay-status update happened to fire
  // and force a recompute. `service` state makes that transition observable.
  const [service, setService] = useState<NdkService | null>(null);
  const [relayStatuses, setRelayStatuses] = useState<Map<string, RelayStatus>>(new Map());
  const [isConnecting, setIsConnecting] = useState(false);

  // Initialize NDK service once
  useEffect(() => {
    if (!serviceRef.current) {
      const instance = new NdkService({
        ...config,
        autoConnect: false, // We'll connect manually after setup
      });
      serviceRef.current = instance;

      // Subscribe to status changes
      const unsubscribe = instance.onStatusChange((statuses) => {
        setRelayStatuses(statuses);

        // Update workspace store with aggregate relay status
        const hasConnected = Array.from(statuses.values()).some(
          (s) => s.status === 'connected'
        );
        updateServiceStatus('relay', { isConnected: hasConnected, lastPing: new Date() });
      });

      // Deferred rather than a direct setService(instance) call here: the
      // singleton is fully constructed by this point, so this only notifies
      // `value` below that it's available -- it's not itself part of the
      // effect's synchronization work.
      queueMicrotask(() => setService(instance));

      return () => {
        unsubscribe();
        serviceRef.current?.disconnect();
      };
    }
  }, [config, updateServiceStatus]);

  // Probe the HTTP-backed services.
  //
  // Only 'relay' was ever given a status above; drive, blossom and signer were
  // seeded isConnected:false and nothing ever updated them, so the Services
  // panel reported them as "Not wired" permanently regardless of whether they
  // were up. This polls each one's /health and reports what it finds.
  //
  // A reachable service is the claim being made, so any HTTP response counts --
  // including 4xx. Blossom answers /health with 400 but is plainly serving, and
  // treating that as "down" would just reproduce the original wrong answer in
  // the other direction. Only a network-level failure means not reachable.
  useEffect(() => {
    // Per-service health path. NOT every service answers /health with 200:
    // blossom returns 400 there, and the browser logs any non-2xx as
    // "Failed to load resource", which the CI smoke gate correctly treats as a
    // console error and fails the build on. Probing an endpoint that is actually
    // healthy avoids manufacturing noise to detect health.
    //   drive/stash  /health              -> 200
    //   signer       /health              -> 200
    //   blossom      /.well-known/blossom -> 200 (BUD-01 discovery)
    const HTTP_SERVICES = [
      { key: 'drive' as const, path: '/health' },
      { key: 'signer' as const, path: '/health' },
      { key: 'blossom' as const, path: '/.well-known/blossom' },
    ];
    let cancelled = false;

    const probe = async () => {
      const services = useWorkspaceStore.getState().services;
      await Promise.all(
        HTTP_SERVICES.map(async ({ key, path }) => {
          const svc = services.get(key);
          if (!svc) return;
          try {
            await fetch(`${svc.url}${path}`, { method: 'GET', mode: 'no-cors' });
            if (!cancelled) {
              updateServiceStatus(key, { isConnected: true, lastPing: new Date() });
            }
          } catch {
            if (!cancelled) {
              updateServiceStatus(key, { isConnected: false, lastPing: new Date() });
            }
          }
        })
      );
    };

    probe();
    const interval = setInterval(probe, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [updateServiceStatus]);

  // Update signer when auth changes
  useEffect(() => {
    if (serviceRef.current) {
      serviceRef.current.setSigner(signer);
    }
  }, [signer]);

  // Auto-connect when authenticated
  useEffect(() => {
    const service = serviceRef.current;
    if (!service) return;

    if (isAuthenticated && !service.hasConnection()) {
      setIsConnecting(true);
      service.connect().finally(() => setIsConnecting(false));
    }
  }, [isAuthenticated]);

  const reconnect = useCallback(async () => {
    const service = serviceRef.current;
    if (!service) return;

    service.disconnect();
    setIsConnecting(true);
    try {
      await service.connect();
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const isConnected = useMemo(() => {
    return Array.from(relayStatuses.values()).some((s) => s.status === 'connected');
  }, [relayStatuses]);

  const subscribe = useCallback<NdkService['subscribe']>(
    // `handlers` must be forwarded. Every hook in the app subscribes through
    // this callback, so dropping the third argument here would silently discard
    // handlers registered at subscribe time -- reintroducing the exact race the
    // helpers exist to close, at every single call site at once, while each
    // call site looked correct.
    (filters, opts, handlers) => {
      const service = serviceRef.current;
      if (!service) {
        throw new Error('NDK not initialized');
      }
      return service.subscribe(filters, opts, handlers);
    },
    []
  );

  const fetchEvents = useCallback<NdkService['fetchEvents']>(
    async (filters) => {
      const service = serviceRef.current;
      if (!service) {
        throw new Error('NDK not initialized');
      }
      return service.fetchEvents(filters);
    },
    []
  );

  const fetchFromOwnRelays = useCallback<NdkService['fetchFromOwnRelays']>(
    async (filters) => {
      const service = serviceRef.current;
      if (!service) {
        throw new Error('NDK not initialized');
      }
      return service.fetchFromOwnRelays(filters);
    },
    []
  );

  const createEvent = useCallback(() => {
    const service = serviceRef.current;
    if (!service) {
      return null;
    }
    return service.createEvent();
  }, []);

  const publish = useCallback<NdkService['publish']>(
    async (event, relaySet) => {
      const service = serviceRef.current;
      if (!service) {
        throw new Error('NDK not initialized');
      }
      return service.publish(event, relaySet);
    },
    []
  );

  const value: NdkContextValue = useMemo(
    () => ({
      service,
      isConnected,
      isConnecting,
      relayStatuses,
      reconnect,
      subscribe: service ? subscribe : null,
      fetchEvents: service ? fetchEvents : null,
      fetchFromOwnRelays: service ? fetchFromOwnRelays : null,
      createEvent,
      publish: service ? publish : null,
    }),
    [service, isConnected, isConnecting, relayStatuses, reconnect, subscribe, fetchEvents, fetchFromOwnRelays, createEvent, publish]
  );

  return <NdkContext.Provider value={value}>{children}</NdkContext.Provider>;
}

/**
 * Hook to access NDK context
 */
export function useNdk() {
  const context = useContext(NdkContext);
  if (!context) {
    throw new Error('useNdk must be used within NdkProvider');
  }
  return context;
}
