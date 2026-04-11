import { createContext, useContext, useState, useCallback } from 'react';
import { authenticateAdmin } from '../api/pocketbase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    const saved = localStorage.getItem('itc_auth');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(false);

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
        loggedInAt: Date.now(),
      };
      localStorage.setItem('itc_auth', JSON.stringify(session));
      setAuth(session);
      return session;
    } catch (e) {
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('itc_auth');
    setAuth(null);
  }, []);

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
    <AuthContext.Provider value={{ auth, login, logout, loading, hasPermission, hasAnyPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
