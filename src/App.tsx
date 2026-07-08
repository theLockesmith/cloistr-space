import { Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, ToastProvider, SharedAuthProvider } from '@cloistr/ui/components';
import '@cloistr/ui/styles';
import { AuthProvider, useAuth } from './components/auth/AuthProvider';
import { SessionManager } from './components/auth/SessionManager';
import { NdkProvider } from './services/nostr';
import { ErrorBoundary, FullPageErrorFallback } from './components/common';
import { MainLayout } from './components/layout/MainLayout';
import { ActivityDashboard } from './components/activity/ActivityDashboard';
import { ProjectsView } from './components/projects/ProjectsView';
import { SocialFeed } from './components/social/SocialFeed';
import { LoginPage } from './components/auth/LoginPage';

// Space is intentionally public: anyone can browse without auth. Signed-in users
// land on their personal Activity dashboard; everyone else lands on the public
// Social feed. Login is an option (shared Header "Sign In"), never a gate.
function IndexRedirect() {
  const { isAuthenticated } = useAuth();
  return <Navigate to={isAuthenticated ? '/activity' : '/social'} replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <SharedAuthProvider>
        <ErrorBoundary
          fallbackRender={({ error, resetError }) => (
            <FullPageErrorFallback error={error} resetError={resetError} />
          )}
          context="App"
        >
          <AuthProvider>
          <NdkProvider>
          <SessionManager />
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />

            {/* Public browsing: no auth gate. MainLayout's shared Header
                carries the "Sign In" option; content degrades gracefully
                without a session (public feed reads, personal widgets empty). */}
            <Route path="/" element={<MainLayout />}>
              {/* Signed-in → Activity; logged-out → public Social feed */}
              <Route index element={<IndexRedirect />} />
              <Route
                path="activity"
                element={
                  <ErrorBoundary context="Activity">
                    <ActivityDashboard />
                  </ErrorBoundary>
                }
              />
              <Route
                path="projects"
                element={
                  <ErrorBoundary context="Projects">
                    <ProjectsView />
                  </ErrorBoundary>
                }
              />
              <Route
                path="projects/:groupId"
                element={
                  <ErrorBoundary context="Projects">
                    <ProjectsView />
                  </ErrorBoundary>
                }
              />
              <Route
                path="social"
                element={
                  <ErrorBoundary context="Social">
                    <SocialFeed />
                  </ErrorBoundary>
                }
              />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </NdkProvider>
        </AuthProvider>
        </ErrorBoundary>
        </SharedAuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
