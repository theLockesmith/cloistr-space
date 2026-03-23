import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AuthMethod = 'nip07' | 'nip46' | null;

interface AuthState {
  pubkey: string | null;
  method: AuthMethod;
  isAuthenticated: boolean;
  isLoading: boolean;
  signerUrl: string | null;

  // Actions
  login: (pubkey: string, method: AuthMethod, signerUrl?: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      pubkey: null,
      method: null,
      isAuthenticated: false,
      isLoading: true,
      signerUrl: null,

      login: (pubkey, method, signerUrl) =>
        set({
          pubkey,
          method,
          isAuthenticated: true,
          isLoading: false,
          signerUrl: signerUrl ?? null,
        }),

      logout: () =>
        set({
          pubkey: null,
          method: null,
          isAuthenticated: false,
          isLoading: false,
          signerUrl: null,
        }),

      setLoading: (isLoading) => set({ isLoading }),
    }),
    {
      name: 'cloistr-space-auth',
      partialize: (state) => ({
        pubkey: state.pubkey,
        method: state.method,
        signerUrl: state.signerUrl,
      }),
    }
  )
);
