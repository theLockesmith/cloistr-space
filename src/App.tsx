import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/auth/AuthProvider';
import { MainLayout } from './components/layout/MainLayout';
import { ActivityDashboard } from './components/activity/ActivityDashboard';
import { ProjectsView } from './components/projects/ProjectsView';
import { SocialFeed } from './components/social/SocialFeed';
import { LoginPage } from './components/auth/LoginPage';
import { AuthGuard } from './components/auth/AuthGuard';

export default function App() {
  return (
    <AuthProvider>
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
          <Route path="activity" element={<ActivityDashboard />} />
          <Route path="projects" element={<ProjectsView />} />
          <Route path="projects/:groupId" element={<ProjectsView />} />
          <Route path="social" element={<SocialFeed />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
