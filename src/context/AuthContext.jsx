import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { authenticateAdmin, getUserRecord } from '../api/pocketbase';

const AuthContext = createContext(null);

// How often we quietly re-sync role/permissions/profile data in the background.
// This ONLY refreshes data — it never logs the user out on its own.
const SESSION_REFRESH_INTERVAL = 5 * 60_000; // 5 minutes

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

  // The ONLY way a session ends now is an explicit, user-initiated logout
  // (e.g. clicking "Sign Out" in the Topbar/Sidebar). Nothing in this file
  // calls this automatically anymore.
  const logout = useCallback(() => {
    localStorage.removeItem('itc_auth');
    setAuth(null);
    if (refreshTimer.current) clearInterval(refreshTimer.current);
  }, []);

  /**
   * Refresh session data from the database — fetches the latest user record
   * and updates permissions, profile, role, etc. without requiring re-login.
   *
   * NOTE: This never force-logs-out the user, even if the record shows
   * isActive === false or the request fails (expired token, network error,
   * server hiccup, etc). It just skips the update and tries again next tick.
   * The user stays signed in until they explicitly choose to log out.
   */
  const refreshSession = useCallback(async () => {
    const currentAuth = authRef.current;
    if (!currentAuth || currentAuth.isSuperuser || !currentAuth.userId) return;
    try {
      const user = await getUserRecord(currentAuth.userId, currentAuth.token);
      if (!user) return;

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
        // isActive is tracked for display purposes only — it no longer
        // triggers an automatic logout.
        isActive: user.isActive !== false,
      };
      localStorage.setItem('itc_auth', JSON.stringify(updated));
      setAuth(updated);
    } catch (e) {
      // Swallow errors on purpose: a failed background refresh (expired
      // token, offline, server error, etc) should never kick the user out.
      console.warn('Session refresh failed (session kept alive):', e.message);
    }
  }, []);

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

  // Background data sync every 5 min for non-superusers.
  // Purely informational — see refreshSession() above for why it can never
  // log anyone out.
  useEffect(() => {
    const authUserId = auth?.userId;
    const authIsSuperuser = auth?.isSuperuser;
    if (!authUserId || authIsSuperuser) return;

    refreshTimer.current = setInterval(refreshSession, SESSION_REFRESH_INTERVAL);
    return () => {
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
