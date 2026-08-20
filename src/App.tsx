import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Sidebar } from '@/components/Sidebar';
import { Layout } from '@/components/Layout';
import { PremiumLoader } from '@/components/Loaders';

import LoginPage from '@/pages/Login';
import RegisterPage from '@/pages/Register';
import DashboardPage from '@/pages/Dashboard';
import ServersPage from '@/pages/Servers';
import CreateServerPage from '@/pages/CreateServer';
import ServerView from '@/pages/ServerView';
import NodesPage from '@/pages/Nodes';
import AccountPage from '@/pages/Account';
import ApiKeysPage from '@/pages/ApiKeys';
import AdminSettingsPage from '@/pages/AdminSettings';
import AdminServersPage from '@/pages/AdminServers';
import SystemUpdatePage from '@/pages/SystemUpdate';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <PremiumLoader label="Loading" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <PremiumLoader label="Loading" />
      </div>
    );
  }
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function NotFound() {
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  const { user } = useAuth();
  const { clearNotifications } = useToast();
  const location = useLocation();

  // Notifications are ephemeral per session view; keep the feed bounded.
  useEffect(() => {
    if (location.pathname === '/dashboard') clearNotifications();
  }, [location.pathname, clearNotifications]);

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnly>
            <RegisterPage />
          </PublicOnly>
        }
      />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/servers" element={<ServersPage />} />
        <Route path="/servers/new" element={<CreateServerPage />} />
        <Route path="/servers/:id" element={<ServerView />} />
        <Route path="/nodes" element={<NodesPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/api-keys" element={<ApiKeysPage />} />
        <Route
          path="/admin/settings"
          element={
            <RequireAdmin>
              <AdminSettingsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/servers"
          element={
            <RequireAdmin>
              <AdminServersPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/update"
          element={
            <RequireAdmin>
              <SystemUpdatePage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
