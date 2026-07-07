import { Navigate } from 'react-router-dom';
import { LoginModal } from '@cloistr/ui/components';
import { useAuth } from './AuthProvider';

export function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();

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

  return (
    <div className="flex min-h-screen flex-col bg-cloistr-dark">
      <LoginModal
        isOpen
        onClose={() => {
          // no-op: on the /login route the modal is always open;
          // the modal's own auth callbacks set isAuthenticated which
          // triggers the Navigate above on the next render
        }}
        signerUrl="https://signer.cloistr.xyz"
      />
    </div>
  );
}
