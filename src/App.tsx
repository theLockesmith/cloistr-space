import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/auth/AuthProvider';
import { SessionManager } from './components/auth/SessionManager';
import { NdkProvider } from './services/nostr';
import { ErrorBoundary, FullPageErrorFallback } from './components/common';
import { MainLayout } from './components/layout/MainLayout';
import { ActivityDashboard } from './components/activity/ActivityDashboard';
import { ProjectsView } from './components/projects/ProjectsView';
import { SocialFeed } from './components/social/SocialFeed';
import { LoginPage } from './components/auth/LoginPage';
import { AuthGuard } from './components/auth/AuthGuard';

export default function App() {
  return (
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
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </NdkProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
