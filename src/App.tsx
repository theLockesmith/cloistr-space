import { Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, ToastProvider, SharedAuthProvider } from '@cloistr/ui/components';
import '@cloistr/ui/styles';
import { AuthProvider } from './components/auth/AuthProvider';
import { SessionManager } from './components/auth/SessionManager';
import { SignerErrorOverlay } from './components/auth/SignerErrorOverlay';
import { NdkProvider } from './services/nostr';
import { ErrorBoundary, FullPageErrorFallback } from './components/common';
import { MainLayout } from './components/layout/MainLayout';
import { ActivityDashboard } from './components/activity/ActivityDashboard';
import { ProjectsView } from './components/projects/ProjectsView';
import { SocialFeed } from './components/social/SocialFeed';
import { FileBrowser } from './components/integrations';
import { LoginPage } from './components/auth/LoginPage';
import { AuthGuard } from './components/auth/AuthGuard';

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
          <SignerErrorOverlay />
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected routes */}
            <Route
              path="/"
              element={
                <AuthGuard>
                  <MainLayout />
                </AuthGuard>
              }
            >
              {/* Default to Activity view */}
              <Route index element={<Navigate to="/activity" replace />} />
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
              {/* FileBrowser was fully built and routed NOWHERE — dead code,
                  and the dashboard's "View all" on Recent Files had no
                  destination to point at. */}
              <Route
                path="files"
                element={
                  <ErrorBoundary context="Files">
                    <FileBrowser />
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
