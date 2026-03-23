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
  type NDKFilter,
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
  const [relayStatuses, setRelayStatuses] = useState<Map<string, RelayStatus>>(new Map());
  const [isConnecting, setIsConnecting] = useState(false);

  // Initialize NDK service once
  useEffect(() => {
    if (!serviceRef.current) {
      serviceRef.current = new NdkService({
        ...config,
        autoConnect: false, // We'll connect manually after setup
      });

      // Subscribe to status changes
      const unsubscribe = serviceRef.current.onStatusChange((statuses) => {
        setRelayStatuses(statuses);

        // Update workspace store with aggregate relay status
        const hasConnected = Array.from(statuses.values()).some(
          (s) => s.status === 'connected'
        );
        updateServiceStatus('relay', { isConnected: hasConnected, lastPing: new Date() });
      });

      return () => {
        unsubscribe();
        serviceRef.current?.disconnect();
      };
    }
  }, [config, updateServiceStatus]);

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
    (filters, opts) => {
      const service = serviceRef.current;
      if (!service) {
        throw new Error('NDK not initialized');
      }
      return service.subscribe(filters, opts);
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
      service: serviceRef.current,
      isConnected,
      isConnecting,
      relayStatuses,
      reconnect,
      subscribe: serviceRef.current ? subscribe : null,
      fetchEvents: serviceRef.current ? fetchEvents : null,
      createEvent,
      publish: serviceRef.current ? publish : null,
    }),
    [isConnected, isConnecting, relayStatuses, reconnect, subscribe, fetchEvents, createEvent, publish]
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

/**
 * Hook for subscribing to Nostr events
 * Automatically manages subscription lifecycle
 */
export function useNostrSubscription(
  filters: NDKFilter | NDKFilter[] | null,
  options?: {
    enabled?: boolean;
    closeOnEose?: boolean;
  }
) {
  const { subscribe, isConnected } = useNdk();
  const eventsRef = useRef<NDKEvent[]>([]);
  const [, forceUpdate] = useState({});
  const [eoseReceived, setEoseReceived] = useState(false);
  const subscriptionActiveRef = useRef(false);

  const enabled = options?.enabled ?? true;
  const canSubscribe = Boolean(subscribe && filters && isConnected && enabled);

  // Create stable filter key for dependency tracking
  const filterKey = useMemo(
    () => (filters ? JSON.stringify(filters) : null),
    [filters]
  );

  useEffect(() => {
    if (!canSubscribe || !subscribe || !filters) {
      eventsRef.current = [];
      subscriptionActiveRef.current = false;
      setEoseReceived(false);
      return;
    }

    // Reset for new subscription
    eventsRef.current = [];
    subscriptionActiveRef.current = true;
    setEoseReceived(false);

    const sub = subscribe(filters, {
      closeOnEose: options?.closeOnEose ?? false,
    });

    sub.on('event', (event: NDKEvent) => {
      eventsRef.current = [...eventsRef.current, event];
      forceUpdate({});
    });

    sub.on('eose', () => {
      subscriptionActiveRef.current = false;
      setEoseReceived(true);
    });

    sub.start();

    return () => {
      sub.stop();
      subscriptionActiveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubscribe, filterKey, options?.closeOnEose]);

  return {
    events: eventsRef.current,
    isLoading: subscriptionActiveRef.current && !eoseReceived,
    eoseReceived,
  };
}
