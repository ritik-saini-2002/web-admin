import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { PcControlProvider } from './context/PcControlContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Roles from './pages/Roles';
import Departments from './pages/Departments';
import Companies from './pages/Companies';
import DatabaseManager from './pages/DatabaseManager';
import SyncQueue from './pages/SyncQueue';
import RemoteControl from './pages/RemoteControl';
import Touchpad from './pages/Touchpad';
import FileBrowser from './pages/FileBrowser';
import AppDirectory from './pages/AppDirectory';

function ProtectedRoute({ children }) {
  const { auth } = useAuth();
  if (!auth) return <Navigate to="/login" replace />;
  return children;
}

/** Route guard that also checks a specific permission */
function PermissionRoute({ permission, children }) {
  const { auth, hasPermission } = useAuth();
  if (!auth) return <Navigate to="/login" replace />;
  if (!hasPermission(permission)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { auth } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={auth ? <Navigate to="/" replace /> : <Login />} />
      <Route
        element={
          <ProtectedRoute>
            <PcControlProvider>
              <Layout />
            </PcControlProvider>
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/users" element={<PermissionRoute permission="view_all_users"><Users /></PermissionRoute>} />
        <Route path="/roles" element={<PermissionRoute permission="manage_roles"><Roles /></PermissionRoute>} />
        <Route path="/departments" element={<PermissionRoute permission="view_all_users"><Departments /></PermissionRoute>} />
        <Route path="/companies" element={<PermissionRoute permission="manage_companies"><Companies /></PermissionRoute>} />
        <Route path="/database" element={<PermissionRoute permission="database_manager"><DatabaseManager /></PermissionRoute>} />
        <Route path="/sync" element={<PermissionRoute permission="system_settings"><SyncQueue /></PermissionRoute>} />
        {/* PC Control — no special permission required, just auth */}
        <Route path="/remote" element={<RemoteControl />} />
        <Route path="/touchpad" element={<Touchpad />} />
        <Route path="/files" element={<FileBrowser />} />
        <Route path="/apps" element={<AppDirectory />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
