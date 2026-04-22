import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  connectNip07,
  connectNip46,
  isNip07Supported,
  isValidBunkerUrl,
  type SignerInterface,
  type Nip46Config,
} from '@cloistr/collab-common/auth';
import { useAuthStore } from '@/stores/authStore';

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
  const store = useAuthStore();
  const [signer, setSigner] = useState<SignerInterface | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nip07Available, setNip07Available] = useState(false);

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

  // Restore session on mount
  useEffect(() => {
    const restoreSession = async () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      console.log('[Auth] Checking for saved session:', stored ? 'found' : 'none');
      if (!stored) {
        store.setLoading(false);
        return;
      }

      try {
        const auth: PersistedAuth = JSON.parse(stored);
        console.log('[Auth] Session data:', {
          method: auth.method,
          hasBunkerUrl: !!auth.bunkerUrl,
          hasClientSecretKey: !!auth.clientSecretKey,
          clientSecretKeyPrefix: auth.clientSecretKey?.slice(0, 16) + '...',
        });

        if (auth.method === 'nip07') {
          if (isNip07Supported()) {
            const nip07Signer = await connectNip07();
            const pubkey = await nip07Signer.getPublicKey();
            setSigner(nip07Signer);
            store.login(pubkey, 'nip07');
          } else {
            // Extension no longer available
            localStorage.removeItem(STORAGE_KEY);
            store.setLoading(false);
          }
        } else if (auth.method === 'nip46' && auth.bunkerUrl) {
          // Use persisted client secret key for session continuity
          if (!auth.clientSecretKey) {
            console.warn('No client secret key found, session cannot be restored');
            localStorage.removeItem(STORAGE_KEY);
            store.setLoading(false);
            return;
          }

          // Add timeout for session restore to prevent infinite hanging
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Session restore timeout')), 15000)
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
          const pubkey = await nip46Signer.getPublicKey();
          console.log('[Auth] Session restored successfully, pubkey:', pubkey.slice(0, 16) + '...');
          setSigner(nip46Signer);
          store.login(pubkey, 'nip46', auth.bunkerUrl);
        }
      } catch (err) {
        console.error('Failed to restore session:', err);
        localStorage.removeItem(STORAGE_KEY);
        store.setLoading(false);
      }
    };

    restoreSession();
  }, [store]);

  const loginNip07 = useCallback(async () => {
    setError(null);
    store.setLoading(true);

    try {
      if (!isNip07Supported()) {
        throw new Error('NIP-07 browser extension not detected. Install Alby, nos2x, or similar.');
      }

      const nip07Signer = await connectNip07();
      const pubkey = await nip07Signer.getPublicKey();

      setSigner(nip07Signer);
      store.login(pubkey, 'nip07');

      // Persist session
      const auth: PersistedAuth = { method: 'nip07' };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect';
      setError(message);
      store.setLoading(false);
      throw err;
    }
  }, [store]);

  const loginNip46 = useCallback(async (bunkerUrl: string) => {
    setError(null);
    store.setLoading(true);

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
      const pubkey = await nip46Signer.getPublicKey();

      setSigner(nip46Signer);
      store.login(pubkey, 'nip46', bunkerUrl);

      // Persist session with client secret key for session continuity
      const clientSecretKey = nip46Signer.getClientSecretKey?.();
      console.log('[Auth] Saving session:', {
        method: 'nip46',
        hasBunkerUrl: !!bunkerUrl,
        hasClientSecretKey: !!clientSecretKey,
        clientSecretKeyPrefix: clientSecretKey?.slice(0, 16) + '...',
      });
      const auth: PersistedAuth = { method: 'nip46', bunkerUrl, clientSecretKey };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to remote signer';
      setError(message);
      store.setLoading(false);
      throw err;
    }
  }, [store]);

  const logout = useCallback(async () => {
    try {
      if (signer?.disconnect) {
        await signer.disconnect();
      }
    } catch (err) {
      console.warn('Error during signer disconnect:', err);
    } finally {
      setSigner(null);
      setError(null);
      localStorage.removeItem(STORAGE_KEY);
      store.logout();
    }
  }, [signer, store]);

  const signEvent = useCallback(async (event: object) => {
    if (!signer) {
      throw new Error('Not authenticated');
    }
    // Type boundary between app and collab-common signer interface
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return signer.signEvent(event as any);
  }, [signer]);

  return (
    <AuthContext.Provider
      value={{
        pubkey: store.pubkey,
        isAuthenticated: store.isAuthenticated,
        isLoading: store.isLoading,
        error,
        signer,
        nip07Available,
        loginNip07,
        loginNip46,
        logout,
        signEvent,
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
