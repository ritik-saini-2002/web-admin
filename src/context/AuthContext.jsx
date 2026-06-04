import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { authenticateAdmin, getUserRecord } from '../api/pocketbase';

const AuthContext = createContext(null);

const SESSION_REFRESH_INTERVAL = 60_000; // 60 seconds

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    const saved = localStorage.getItem('itc_auth');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(false);
  const refreshTimer = useRef(null);
  const authRef = useRef(auth);

  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    try {
      const result = await authenticateAdmin(email, password);

      // Check if user is active (for non-superusers)
      if (!result.isSuperuser && result.isActive === false) {
        throw new Error('Your account has been deactivated. Contact an administrator.');
      }

      const session = {
        token: result.token,
        isSuperuser: result.isSuperuser,
        userId: result.userId || null,
        email: result.email,
        name: result.name,
        role: result.role,
        permissions: result.permissions || [],
        companyName: result.companyName || '',
        department: result.department || '',
        designation: result.designation || '',
        profile: result.profile || '{}',
        workStats: result.workStats || '{}',
        issues: result.issues || '{}',
        loggedInAt: Date.now(),
      };
      localStorage.setItem('itc_auth', JSON.stringify(session));
      setAuth(session);
      return session;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('itc_auth');
    setAuth(null);
    if (refreshTimer.current) clearInterval(refreshTimer.current);
  }, []);

  /**
   * Refresh session from database — fetches latest user record and updates
   * permissions, profile, role, etc. without requiring re-login.
   */
  const refreshSession = useCallback(async () => {
    const currentAuth = authRef.current;
    if (!currentAuth || currentAuth.isSuperuser || !currentAuth.userId) return;
    try {
      const user = await getUserRecord(currentAuth.userId, currentAuth.token);
      if (!user) return;

      // Check if disabled
      if (user.isActive === false) {
        logout();
        return;
      }

      let perms = [];
      try { perms = JSON.parse(user.permissions || '[]'); } catch { perms = []; }

      const updated = {
        ...currentAuth,
        name: user.name || currentAuth.name,
        role: user.role || currentAuth.role,
        permissions: perms.length > 0 ? perms : currentAuth.permissions,
        companyName: user.companyName || currentAuth.companyName,
        department: user.department || currentAuth.department,
        designation: user.designation || currentAuth.designation,
        profile: user.profile || currentAuth.profile || '{}',
        workStats: user.workStats || currentAuth.workStats || '{}',
        issues: user.issues || currentAuth.issues || '{}',
      };
      localStorage.setItem('itc_auth', JSON.stringify(updated));
      setAuth(updated);
    } catch (e) {
      console.warn('Session refresh failed:', e.message);
    }
  }, [logout]);

  /**
   * Update the user's profile data and refresh session.
   * `data` should be an object of fields to PATCH.
   */
  const updateLocalSession = useCallback((updates) => {
    if (!auth) return;
    const updated = { ...auth, ...updates };
    localStorage.setItem('itc_auth', JSON.stringify(updated));
    setAuth(updated);
  }, [auth]);

  // Auto-refresh session every 60s for non-superusers
  useEffect(() => {
    const authUserId = auth?.userId;
    const authIsSuperuser = auth?.isSuperuser;
    if (!authUserId || authIsSuperuser) return;

    const initialRefresh = setTimeout(refreshSession, 5000);
    refreshTimer.current = setInterval(refreshSession, SESSION_REFRESH_INTERVAL);
    return () => {
      clearTimeout(initialRefresh);
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [auth?.userId, auth?.isSuperuser, refreshSession]);

  /** Check if logged-in user has a specific permission */
  const hasPermission = useCallback((perm) => {
    if (!auth) return false;
    if (auth.isSuperuser) return true;
    return auth.permissions?.includes(perm) ?? false;
  }, [auth]);

  /** Check if logged-in user has any of the given permissions */
  const hasAnyPermission = useCallback((perms) => {
    if (!auth) return false;
    if (auth.isSuperuser) return true;
    return perms.some(p => auth.permissions?.includes(p));
  }, [auth]);

  return (
    <AuthContext.Provider value={{
      auth, login, logout, loading,
      hasPermission, hasAnyPermission,
      refreshSession, updateLocalSession,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
