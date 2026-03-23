import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AuthMethod = 'nip07' | 'nip46' | null;

/** Session timeout in milliseconds (30 minutes) */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** Warning threshold before session expires (5 minutes) */
export const SESSION_WARNING_MS = 5 * 60 * 1000;

interface AuthState {
  pubkey: string | null;
  method: AuthMethod;
  isAuthenticated: boolean;
  isLoading: boolean;
  signerUrl: string | null;

  // Session management
  lastActivity: number;
  sessionExpiresAt: number | null;

  // Actions
  login: (pubkey: string, method: AuthMethod, signerUrl?: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  updateActivity: () => void;
  extendSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      pubkey: null,
      method: null,
      isAuthenticated: false,
      isLoading: true,
      signerUrl: null,
      lastActivity: Date.now(),
      sessionExpiresAt: null,

      login: (pubkey, method, signerUrl) => {
        const now = Date.now();
        set({
          pubkey,
          method,
          isAuthenticated: true,
          isLoading: false,
          signerUrl: signerUrl ?? null,
          lastActivity: now,
          sessionExpiresAt: now + SESSION_TIMEOUT_MS,
        });
      },

      logout: () =>
        set({
          pubkey: null,
          method: null,
          isAuthenticated: false,
          isLoading: false,
          signerUrl: null,
          lastActivity: Date.now(),
          sessionExpiresAt: null,
        }),

      setLoading: (isLoading) => set({ isLoading }),

      updateActivity: () => {
        const state = get();
        if (!state.isAuthenticated) return;

        const now = Date.now();
        set({
          lastActivity: now,
          sessionExpiresAt: now + SESSION_TIMEOUT_MS,
        });
      },

      extendSession: () => {
        const state = get();
        if (!state.isAuthenticated) return;

        const now = Date.now();
        set({
          lastActivity: now,
          sessionExpiresAt: now + SESSION_TIMEOUT_MS,
        });
      },
    }),
    {
      name: 'cloistr-space-auth',
      partialize: (state) => ({
        pubkey: state.pubkey,
        method: state.method,
        signerUrl: state.signerUrl,
        lastActivity: state.lastActivity,
        sessionExpiresAt: state.sessionExpiresAt,
      }),
    }
  )
);
