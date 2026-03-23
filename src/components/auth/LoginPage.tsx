import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

type LoginView = 'select' | 'nip46';

export function LoginPage() {
  const { isAuthenticated, isLoading, error, nip07Available, loginNip07, loginNip46 } = useAuth();
  const [view, setView] = useState<LoginView>('select');
  const [bunkerUrl, setBunkerUrl] = useState('');
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-cloistr-dark">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-cloistr-primary border-t-transparent" />
          <p className="text-cloistr-light/60">Restoring session...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/activity" replace />;
  }

  const handleNip07Login = async () => {
    setLocalError(null);
    setLocalLoading(true);
    try {
      await loginNip07();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setLocalLoading(false);
    }
  };

  const handleNip46Login = async () => {
    setLocalError(null);
    setLocalLoading(true);
    try {
      await loginNip46(bunkerUrl);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setLocalLoading(false);
    }
  };

  const displayError = localError || error;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cloistr-dark p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo and title */}
        <div className="text-center">
          <h1 className="text-4xl font-bold text-cloistr-primary">Cloistr Space</h1>
          <p className="mt-2 text-cloistr-light/60">Your Nostr-native workspace</p>
        </div>

        {view === 'select' && (
          <div className="space-y-4 rounded-lg border border-cloistr-light/10 bg-cloistr-dark/50 p-6">
            <h2 className="text-center text-lg font-medium text-cloistr-light">
              Connect your identity
            </h2>

            {displayError && (
              <div className="rounded-md bg-red-500/10 p-3 text-center text-sm text-red-400">
                {displayError}
              </div>
            )}

            {/* NIP-07 Button */}
            <button
              onClick={handleNip07Login}
              disabled={localLoading || !nip07Available}
              className="flex w-full items-center justify-center gap-3 rounded-lg bg-cloistr-primary px-4 py-3 font-medium text-white transition-colors hover:bg-cloistr-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {localLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <>
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
                  </svg>
                  Browser Extension (NIP-07)
                </>
              )}
            </button>
            {!nip07Available && (
              <p className="text-center text-xs text-cloistr-light/40">
                No extension detected. Install Alby, nos2x, or similar.
              </p>
            )}

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-cloistr-light/10" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-cloistr-dark px-2 text-cloistr-light/40">or</span>
              </div>
            </div>

            {/* NIP-46 Button */}
            <button
              onClick={() => setView('nip46')}
              disabled={localLoading}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-cloistr-light/20 px-4 py-3 font-medium text-cloistr-light transition-colors hover:bg-cloistr-light/5 disabled:opacity-50"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
              </svg>
              Remote Signer (NIP-46)
            </button>
          </div>
        )}

        {view === 'nip46' && (
          <div className="space-y-4 rounded-lg border border-cloistr-light/10 bg-cloistr-dark/50 p-6">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setView('select');
                  setLocalError(null);
                }}
                className="rounded-lg p-1 text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-lg font-medium text-cloistr-light">Remote Signer</h2>
            </div>

            {displayError && (
              <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-400">
                {displayError}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-medium text-cloistr-light/80">
                Bunker URL
              </label>
              <input
                type="text"
                value={bunkerUrl}
                onChange={(e) => setBunkerUrl(e.target.value)}
                placeholder="bunker://pubkey?relay=wss://relay.example.com"
                className="w-full rounded-lg border border-cloistr-light/20 bg-transparent px-4 py-3 text-sm text-cloistr-light placeholder-cloistr-light/40 focus:border-cloistr-primary focus:outline-none"
              />
              <p className="text-xs text-cloistr-light/40">
                Get this from your remote signer (nsecbunker, Amber, etc.)
              </p>
            </div>

            <button
              onClick={handleNip46Login}
              disabled={localLoading || !bunkerUrl.trim()}
              className="flex w-full items-center justify-center gap-3 rounded-lg bg-cloistr-primary px-4 py-3 font-medium text-white transition-colors hover:bg-cloistr-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {localLoading ? (
                <>
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Connecting...
                </>
              ) : (
                'Connect'
              )}
            </button>

            <div className="rounded-lg bg-cloistr-light/5 p-3">
              <p className="text-xs text-cloistr-light/60">
                <strong className="text-cloistr-light/80">Using Cloistr Signer?</strong>
                <br />
                Visit{' '}
                <a
                  href="https://signer.cloistr.xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cloistr-primary hover:underline"
                >
                  signer.cloistr.xyz
                </a>{' '}
                to get your bunker URL.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-sm text-cloistr-light/40">
          Your keys, your data, your space.
        </p>
      </div>
    </div>
  );
}
