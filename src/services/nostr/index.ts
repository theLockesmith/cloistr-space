/**
 * @fileoverview Nostr services index
 * Re-exports NDK service, provider, and hooks
 */

export {
  NdkService,
  SignerAdapter,
  NDKEvent,
  NDKRelaySet,
  NDKUser,
  type RelayStatus,
  type NdkServiceConfig,
  type NDKFilter,
} from './ndk';

export {
  NdkProvider,
  useNdk,
  useNostrSubscription,
} from './NdkProvider';

export { RelayAuthPolicy, type RelayAuthPolicyState } from './authPolicy';

export { resolveAndApplyRelays, type ResolveResult } from './relayPrefs';
export { useRelayPrefsSync } from './useRelayPrefsSync';
