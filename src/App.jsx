import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { PcControlProvider } from './context/PcControlContext';
import Layout from './components/Layout';
import { lazy, Suspense, Component } from 'react';

const routerBasename =
    window.location.pathname === '/web-admin' || window.location.pathname.startsWith('/web-admin/')
        ? '/web-admin'
        : undefined;

// ── Lazy-loaded pages ──────────────────────────────────────────────
const Login           = lazy(() => import('./pages/Login'));
const Dashboard       = lazy(() => import('./pages/Dashboard'));
const Users           = lazy(() => import('./pages/Users'));
const Roles           = lazy(() => import('./pages/Roles'));
const Departments     = lazy(() => import('./pages/Departments'));
const Companies       = lazy(() => import('./pages/Companies'));
const DatabaseManager = lazy(() => import('./pages/DatabaseManager'));
const SyncQueue       = lazy(() => import('./pages/SyncQueue'));
const RemoteControl   = lazy(() => import('./pages/RemoteControl'));
const Touchpad        = lazy(() => import('./pages/Touchpad'));
const FileBrowser     = lazy(() => import('./pages/FileBrowser'));
const AppDirectory    = lazy(() => import('./pages/AppDirectory'));
const Profile         = lazy(() => import('./pages/Profile'));
const Aicontrol       = lazy(() => import('./ai/Aicontrol.jsx'));   // ← NEW

function PageLoader() {
  return (
      <div className="loading-overlay">
        <div className="spinner spinner-lg" />
        <span>Loading...</span>
      </div>
  );
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, errorInfo) { console.error('ErrorBoundary caught:', error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
          <div className="error-boundary">
            <div className="error-boundary-card">
              <h2>⚠️ Something went wrong</h2>
              <p>{this.state.error?.message || 'An unexpected error occurred.'}</p>
              <button className="btn btn-primary" onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}>
                Reload Page
              </button>
            </div>
          </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedRoute({ children }) {
  const { auth } = useAuth();
  if (!auth) return <Navigate to="/login" replace />;
  return children;
}

function PermissionRoute({ permission, altPermission, children }) {
  const { auth, hasPermission } = useAuth();
  if (!auth) return <Navigate to="/login" replace />;
  if (!hasPermission(permission) && !(altPermission && hasPermission(altPermission))) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function AppRoutes() {
  const { auth } = useAuth();
  return (
      <Suspense fallback={<PageLoader />}>
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
            <Route path="/"          element={<Dashboard />} />
            <Route path="/profile"   element={<Profile />} />
            <Route path="/users"     element={<PermissionRoute permission="view_all_users" altPermission="view_team_users"><Users /></PermissionRoute>} />
            <Route path="/roles"     element={<PermissionRoute permission="manage_roles"><Roles /></PermissionRoute>} />
            <Route path="/departments" element={<PermissionRoute permission="view_all_users"><Departments /></PermissionRoute>} />
            <Route path="/companies" element={<PermissionRoute permission="manage_companies"><Companies /></PermissionRoute>} />
            <Route path="/database"  element={<PermissionRoute permission="database_manager"><DatabaseManager /></PermissionRoute>} />
            <Route path="/sync"      element={<PermissionRoute permission="system_settings"><SyncQueue /></PermissionRoute>} />
            {/* PC Control */}
            <Route path="/ai"        element={<PermissionRoute permission="remote_access"><Aicontrol /></PermissionRoute>} />  {/* ← NEW */}
            <Route path="/remote"    element={<PermissionRoute permission="remote_access"><RemoteControl /></PermissionRoute>} />
            <Route path="/touchpad"  element={<PermissionRoute permission="remote_access"><Touchpad /></PermissionRoute>} />
            <Route path="/files"     element={<PermissionRoute permission="remote_access"><FileBrowser /></PermissionRoute>} />
            <Route path="/apps"      element={<PermissionRoute permission="remote_access"><AppDirectory /></PermissionRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
  );
}

export default function App() {
  return (
      <BrowserRouter basename={routerBasename}>
        <ErrorBoundary>
          <ThemeProvider>
            <AuthProvider>
              <ToastProvider>
                <AppRoutes />
              </ToastProvider>
            </AuthProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </BrowserRouter>
  );
}