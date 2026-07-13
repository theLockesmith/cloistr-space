import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { LoginModal, Header as UnifiedHeader } from '@cloistr/ui/components';
import { useAuth } from './AuthProvider';

const SIGNER_URL = 'https://signer.cloistr.xyz';

const FEATURES = [
  { icon: '🗂️', title: 'Your workspace', body: 'Activity, projects, files, and tasks in one place — all keyed to your Nostr identity.' },
  { icon: '🔑', title: 'Own your data', body: 'No account to create. Sign in with the identity you already control; leave anytime with everything.' },
  { icon: '🤝', title: 'Collaborate', body: 'Shared projects and real-time documents over Nostr relays — no central gatekeeper.' },
];

export function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-cloistr-dark">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-cloistr-primary border-t-transparent" />
          <p className="text-cloistr-light/60">Signing you in…</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/activity" replace />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-cloistr-dark">
      <UnifiedHeader
        activeServiceId="space"
        auth={{ authenticated: false }}
        signerUrl="https://signer.cloistr.xyz"
      />
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="max-w-2xl">
        <h1 className="mb-3 text-4xl font-bold text-cloistr-light">Cloistr Space</h1>
        <p className="mb-8 text-xl text-cloistr-light/60">
          Your Nostr-native workspace — activity, projects, files, and tasks, all under your own key.
        </p>

        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-cloistr-primary px-6 py-3 font-medium text-white transition-colors hover:opacity-90"
        >
          Sign in with Cloistr
        </button>
        <p className="mt-3 text-sm text-cloistr-light/60">
          New here? Get a Nostr identity at{' '}
          <a href={SIGNER_URL} className="text-cloistr-primary hover:underline">
            signer.cloistr.xyz
          </a>
        </p>

        <div className="mt-12 grid gap-6 text-left sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-lg border border-cloistr-light/10 p-4">
              <div className="mb-2 text-2xl">{f.icon}</div>
              <div className="mb-1 font-semibold text-cloistr-light">{f.title}</div>
              <div className="text-sm text-cloistr-light/60">{f.body}</div>
            </div>
          ))}
        </div>
      </div>

      </div>

      <LoginModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        signerUrl={SIGNER_URL}
      />
    </div>
  );
}
