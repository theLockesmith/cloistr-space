import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import {
  connectNip07,
  connectNip46,
  isNip07Supported,
  isValidBunkerUrl,
  useNostrAuth,
  type SignerInterface,
  type Nip46Config,
} from '@cloistr/auth';
import {
  getSharedSession,
  saveSharedSession,
  clearSharedSession,
  withSignerRetry,
  classifySignerError,
} from '@cloistr/ui';
import { useAuthStore } from '@/stores/authStore';
import { useContactsStore } from '@/stores/contactsStore';

interface AuthContextValue {
  pubkey: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  signer: SignerInterface | null;
  nip07Available: boolean;
  loginNip07: () => Promise<void>;
  loginNip46: (bunkerUrl: string) => Promise<void>;
  logout: () => Promise<void>;
  signEvent: (event: object) => Promise<object>;
  /**
   * Non-null when a signing or signer-connection attempt failed.
   * The session is still valid; this is a connectivity problem, not an auth
   * problem. See SignerErrorOverlay, which renders SignerRecovery on this state.
   */
  signerError: unknown | null;
  /** Clear the error after the user has acknowledged or retried. */
  clearSignerError: () => void;
  /**
   * Re-attempt the NIP-46 signer connection using the stored credentials.
   * Safe to call when signerError is set; clears the error before trying.
   */
  retrySignerConnection: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// IMPORTANT: Use a different key than authStore's 'cloistr-space-auth'
// to avoid zustand persist overwriting our session data
const STORAGE_KEY = 'cloistr-space-session';

interface PersistedAuth {
  method: 'nip07' | 'nip46';
  bunkerUrl?: string;
  /** Client secret key (hex) for NIP-46 session persistence */
  clientSecretKey?: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Select specific state values to avoid re-render on every state change
  const pubkey = useAuthStore((state) => state.pubkey);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);

  // Get stable action references (these don't change between renders).
  // Select each action directly rather than snapshotting useAuthStore.getState()
  // into a ref: zustand action identities are stable for the store's lifetime,
  // so a plain selector already gives referential stability without reading a
  // React ref during render (react-hooks/refs flagged the ref.current reads
  // below, since they fed straight into effect/callback dependency arrays).
  const storeLogin = useAuthStore((state) => state.login);
  const storeLogout = useAuthStore((state) => state.logout);
  const setLoading = useAuthStore((state) => state.setLoading);

  const [signer, setSigner] = useState<SignerInterface | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nip07Available, setNip07Available] = useState(false);
  /**
   * Signer connectivity error — distinct from session validity.
   *
   * Session = who you are (backend JWT + shared SSO). Only a genuine expiry
   * means "sign in again". Signer reachability = can we reach your bunker over
   * relays RIGHT NOW. Transient. Retry.
   *
   * This state is set on retryable and needs-user signing failures. It is
   * never set by a genuine session expiry. Setting it must NEVER also clear
   * the session (localStorage key or authStore).
   */
  const [signerError, setSignerError] = useState<unknown | null>(null);

  // SSO bridge: SharedAuthProvider (@cloistr/ui) restores the cross-subdomain
  // signer session into @cloistr/auth's context, but space gates on its OWN
  // local store — which the SSO path never populated, so a user logged in on
  // another *.cloistr.xyz app still hit space's /login wall (the "SSO doesn't
  // maintain across pages" bug). Mirror the shared session (pubkey + method +
  // the live signer) into the local store so AuthGuard passes and writes work.
  // Safe against the mount race because @cloistr/ui 0.12.5's isResolving gate
  // holds children unmounted until the SSO restore settles, so `shared` is
  // already resolved by the time this provider mounts.
  const shared = useNostrAuth();
  useEffect(() => {
    const { isConnected, pubkey: sharedPubkey, method } = shared.authState;
    if (isConnected && sharedPubkey && !isAuthenticated) {
      // Deferred a tick rather than called synchronously here: storeLogin
      // writes through to authStore's persisted (localStorage) state, not
      // just local React state, so this is really "update an external
      // system" (category 3 in the set-state-in-effect guidance) rather than
      // the derived-render-state case the rule mainly targets. The condition
      // is self-limiting regardless -- storeLogin flips isAuthenticated,
      // which is this same effect's own dependency, so it re-runs once more
      // and then no-ops.
      queueMicrotask(() => {
        setSigner(shared.signer);
        storeLogin(sharedPubkey, method ?? 'nip46', 'https://signer.cloistr.xyz');
      });
    }
  }, [shared.authState, shared.signer, isAuthenticated, storeLogin]);

  // Key-switcher: when the user switches identities in the Header's account
  // menu, @cloistr/auth 0.2.0 updates authState.activePubkey and re-points
  // `signer` to the new key's signer. Space has its own local authStore and
  // contactsStore that don't observe the shared session, so we bridge the
  // change here. On every activePubkey change after the initial mount we:
  //   1. Update the local authStore so all pubkey-scoped hooks (useGroups,
  //      useFeed, useContactsSync) re-scope to the new identity.
  //   2. Replace the local signer state so NdkProvider picks up the new signer.
  //   3. Reset contactsStore (contacts + CRDT) because it holds in-memory data
  //      scoped to the previous key; the sync hooks will repopulate it.
  const prevActivePubkeyRef = useRef<string | null>(null);
  const resetContacts = useContactsStore((s) => s.setContacts);
  useEffect(() => {
    const { activePubkey, isConnected, method, isSwitching } = shared.authState;

    // Skip: not yet connected, or switch still in flight
    if (!isConnected || isSwitching || !activePubkey) return;

    // Skip initial population (handled by the SSO bridge above)
    if (prevActivePubkeyRef.current === null) {
      prevActivePubkeyRef.current = activePubkey;
      return;
    }

    // Skip if the key hasn't actually changed
    if (prevActivePubkeyRef.current === activePubkey) return;

    console.log('[Auth] Key switch detected:', prevActivePubkeyRef.current, '→', activePubkey);
    prevActivePubkeyRef.current = activePubkey;

    // 1. Update signer for the new key
    setSigner(shared.signer);

    // 2. Re-scope local authStore — useGroups/useFeed/useContactsSync all
    //    read pubkey from here and will re-subscribe when it changes.
    storeLogin(activePubkey, method ?? 'nip46', 'https://signer.cloistr.xyz');

    // 3. Clear contacts for the old key so useContactsSync starts fresh
    resetContacts(new Map());
  }, [shared.authState, shared.signer, storeLogin, resetContacts]);

  // Check for NIP-07 extension on mount
  useEffect(() => {
    const checkExtension = () => {
      setNip07Available(isNip07Supported());
    };

    // Check immediately and after a short delay (extensions may load late)
    checkExtension();
    const timeout = setTimeout(checkExtension, 500);
    return () => clearTimeout(timeout);
  }, []);

  // Restore session on mount - check local storage first, then shared session
  useEffect(() => {
    const restoreSession = async () => {
      let stored = localStorage.getItem(STORAGE_KEY);
      console.log('[Auth] Checking for saved session:', stored ? 'found' : 'none');

      // If no local session, check shared session cookie (SSO)
      if (!stored) {
        const sharedSession = getSharedSession();
        if (sharedSession) {
          console.log('[Auth] Found shared session from another Cloistr app:', sharedSession.method);
          // Convert shared session format to our local format
          stored = JSON.stringify({
            method: sharedSession.method,
            bunkerUrl: sharedSession.bunkerUrl,
          } as PersistedAuth);
        }
      }

      if (!stored) {
        setLoading(false);
        return;
      }

      // Parse the stored session outside the restore try/catch so the catch
      // can reference `auth` when deciding whether to preserve the session.
      let auth: PersistedAuth;
      try {
        auth = JSON.parse(stored);
      } catch {
        // Corrupted data — nothing to recover.
        localStorage.removeItem(STORAGE_KEY);
        setLoading(false);
        return;
      }

      try {
        console.log('[Auth] Session data:', {
          method: auth.method,
          hasBunkerUrl: !!auth.bunkerUrl,
          hasClientSecretKey: !!auth.clientSecretKey,
          clientSecretKeyPrefix: auth.clientSecretKey?.slice(0, 16) + '...',
        });

        if (auth.method === 'nip07') {
          if (isNip07Supported()) {
            const nip07Signer = await connectNip07();
            const nip07Pubkey = await nip07Signer.getPublicKey();
            setSigner(nip07Signer);
            storeLogin(nip07Pubkey, 'nip07');
            // Sync to shared session
            saveSharedSession({ method: 'nip07', pubkey: nip07Pubkey });
          } else {
            // Extension no longer available — terminal, clear the session.
            localStorage.removeItem(STORAGE_KEY);
            setLoading(false);
          }
        } else if (auth.method === 'nip46' && auth.bunkerUrl) {
          // Use persisted client secret key for session continuity
          if (!auth.clientSecretKey) {
            console.warn('No client secret key found, session cannot be restored');
            localStorage.removeItem(STORAGE_KEY);
            setLoading(false);
            return;
          }

          // The timeout error needs a code so classifySignerError can handle
          // it correctly. A bare Error with no code is classified 'terminal',
          // which would cause the session to be wrongly cleared when the race
          // fires before @cloistr/auth's own internal timeout does.
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => {
              const err = Object.assign(
                new Error('Session restore timeout'),
                { code: 'TIMEOUT' },
              );
              reject(err);
            }, 15000)
          );
          console.log('[Auth] Attempting session restore with NIP-46...');
          const nip46Signer = await Promise.race([
            connectNip46({
              bunkerUrl: auth.bunkerUrl,
              timeout: 15000,
              clientSecretKey: auth.clientSecretKey,
            }),
            timeoutPromise,
          ]);
          console.log('[Auth] NIP-46 connected, getting public key...');
          const nip46Pubkey = await nip46Signer.getPublicKey();
          console.log('[Auth] Session restored successfully, pubkey:', nip46Pubkey.slice(0, 16) + '...');
          setSigner(nip46Signer);
          storeLogin(nip46Pubkey, 'nip46', auth.bunkerUrl);
          // Sync to shared session
          saveSharedSession({ method: 'nip46', pubkey: nip46Pubkey, bunkerUrl: auth.bunkerUrl });
        } else {
          // A SESSION WE CANNOT RESTORE FROM. This is what locked the operator
          // out: a shared SSO session reporting method 'nip46' with no
          // bunkerUrl, so neither branch above ran, nothing resolved the
          // loading state, and the app sat on "Loading..." forever -- no error,
          // no login screen, no way to act.
          //
          // THE SHARED SESSION IS DELIBERATELY NOT CLEARED. bunkerUrl is
          // written into it only by a SUCCESSFUL connect (see the
          // saveSharedSession calls below), so its absence means bootstrap has
          // not succeeded YET -- not that the session is corrupt. The observed
          // cause is the signer answering 409 key_locked, which is transient
          // and resolves when the user unlocks their key. Deleting the shared
          // session over that would sign them out of every Cloistr app to
          // "fix" a server-side condition that was going to clear on its own.
          //
          // Only the local copy goes, and it is the one this function
          // synthesised a moment ago rather than anything the user established.
          console.warn('[Auth] Cannot restore from this session:', {
            method: auth.method,
            hasBunkerUrl: !!auth.bunkerUrl,
            hasClientSecretKey: !!auth.clientSecretKey,
          });
          localStorage.removeItem(STORAGE_KEY);
          setError('We could not restore your previous session. Please sign in again.');
        }
      } catch (err) {
        console.error('[Auth] Failed to restore session:', err);

        const kind = classifySignerError(err);
        const persistedPubkey = useAuthStore.getState().pubkey;
        const persistedMethod = useAuthStore.getState().method;

        if (kind !== 'terminal' && persistedPubkey && persistedMethod) {
          // Relay was unreachable or timed out. The credential in localStorage
          // is still valid, so do NOT remove it. Use the persisted pubkey to
          // keep isAuthenticated true — AuthGuard passes, and the user lands in
          // the app rather than at the login screen. The signer stays null, so
          // signing attempts will fail until the user hits Retry in the overlay.
          storeLogin(persistedPubkey, persistedMethod, auth.bunkerUrl);
          setSignerError(err);
        } else {
          // Terminal failure (e.g., INVALID_BUNKER_URL, corrupted key) or no
          // persisted identity to fall back on. Clear the session.
          localStorage.removeItem(STORAGE_KEY);
          setLoading(false);
        }
      } finally {
        // THE STRUCTURAL GUARANTEE. Every branch above already tries to resolve
        // the loading state, and one of them did not -- which is not a bug you
        // can fix by adding one more setLoading call, because the next branch
        // somebody adds will forget too.
        //
        // A missed call here does not render an error. It renders an eternal
        // spinner, which is indistinguishable from a slow network, which is why
        // the operator waited instead of reloading. The UI must leave the
        // loading state no matter how this function exits.
        setLoading(false);
      }
    };

    restoreSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount - actions are stable refs

  const loginNip07 = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      if (!isNip07Supported()) {
        throw new Error('NIP-07 browser extension not detected. Install Alby, nos2x, or similar.');
      }

      const nip07Signer = await connectNip07();
      const nip07Pubkey = await nip07Signer.getPublicKey();

      setSigner(nip07Signer);
      storeLogin(nip07Pubkey, 'nip07');

      // Persist session locally
      const auth: PersistedAuth = { method: 'nip07' };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));

      // Sync to shared session for SSO across Cloistr apps
      saveSharedSession({ method: 'nip07', pubkey: nip07Pubkey });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect';
      setError(message);
      setLoading(false);
      throw err;
    }
  }, [storeLogin, setLoading]);

  const loginNip46 = useCallback(async (bunkerUrl: string) => {
    setError(null);
    setLoading(true);

    try {
      if (!bunkerUrl.trim()) {
        throw new Error('Bunker URL is required');
      }

      if (!isValidBunkerUrl(bunkerUrl)) {
        throw new Error('Invalid bunker URL format. Expected: bunker://<pubkey>?relay=<relay_url>');
      }

      const config: Nip46Config = {
        bunkerUrl,
        timeout: 30000,
      };

      const nip46Signer = await connectNip46(config);
      const nip46Pubkey = await nip46Signer.getPublicKey();

      setSigner(nip46Signer);
      storeLogin(nip46Pubkey, 'nip46', bunkerUrl);

      // Persist session locally with client secret key for session continuity
      const clientSecretKey = nip46Signer.getClientSecretKey?.();
      console.log('[Auth] Saving session:', {
        method: 'nip46',
        hasBunkerUrl: !!bunkerUrl,
        hasClientSecretKey: !!clientSecretKey,
        clientSecretKeyPrefix: clientSecretKey?.slice(0, 16) + '...',
      });
      const auth: PersistedAuth = { method: 'nip46', bunkerUrl, clientSecretKey };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));

      // Sync to shared session for SSO across Cloistr apps
      saveSharedSession({ method: 'nip46', pubkey: nip46Pubkey, bunkerUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to remote signer';
      setError(message);
      setLoading(false);
      throw err;
    }
  }, [storeLogin, setLoading]);

  const logoutHandler = useCallback(async () => {
    try {
      if (signer?.disconnect) {
        await signer.disconnect();
      }
    } catch (err) {
      console.warn('Error during signer disconnect:', err);
    } finally {
      setSigner(null);
      setError(null);
      setSignerError(null);
      localStorage.removeItem(STORAGE_KEY);
      // Clear shared session for SSO logout
      clearSharedSession();
      storeLogout();
    }
  }, [signer, storeLogout]);

  /**
   * Re-attempt the NIP-46 signer connection using the stored credentials.
   *
   * Called by SignerErrorOverlay when the user clicks "Try again" after a
   * session-restore failure. The retry uses withSignerRetry so RETRYABLE
   * errors are retried automatically; a TIMEOUT or terminal error surfaces
   * immediately so the user can see it and decide.
   */
  const retrySignerConnection = useCallback(async () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    let auth: PersistedAuth;
    try {
      auth = JSON.parse(stored);
    } catch {
      return;
    }

    if (auth.method !== 'nip46' || !auth.bunkerUrl || !auth.clientSecretKey) return;

    setSignerError(null);

    try {
      const nip46Signer = await withSignerRetry(() =>
        connectNip46({
          bunkerUrl: auth.bunkerUrl!,
          timeout: 15000,
          clientSecretKey: auth.clientSecretKey,
        })
      );
      const retryPubkey = await nip46Signer.getPublicKey();
      setSigner(nip46Signer);
      storeLogin(retryPubkey, 'nip46', auth.bunkerUrl);
      saveSharedSession({ method: 'nip46', pubkey: retryPubkey, bunkerUrl: auth.bunkerUrl! });
    } catch (err) {
      console.error('[Auth] Retry signer connection failed:', err);
      setSignerError(err);
    }
  }, [storeLogin]);

  const clearSignerError = useCallback(() => {
    setSignerError(null);
  }, []);

  const signEvent = useCallback(async (event: object): Promise<object> => {
    if (!signer) {
      throw new Error('Not authenticated');
    }
    // Type boundary between app and collab-common signer interface
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signerFn = signer as any;
    try {
      return (await withSignerRetry(() => signerFn.signEvent(event))) as object;
    } catch (err) {
      // withSignerRetry rethrows after exhausting retries (for retryable
      // errors) or immediately (for terminal/needs-user). Record the error so
      // SignerErrorOverlay can surface it. Session state is untouched.
      setSignerError(err);
      throw err;
    }
  }, [signer]);

  return (
    <AuthContext.Provider
      value={{
        pubkey,
        isAuthenticated,
        isLoading,
        error,
        signer,
        nip07Available,
        loginNip07,
        loginNip46,
        logout: logoutHandler,
        signEvent,
        signerError,
        clearSignerError,
        retrySignerConnection,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
