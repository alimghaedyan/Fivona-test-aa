import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | anon | authed

  useEffect(() => {
    let alive = true;
    api.me()
      .then((u) => { if (alive) { setUser(u); setStatus('authed'); } })
      .catch(() => { if (alive) { setUser(null); setStatus('anon'); } });
    return () => { alive = false; };
  }, []);

  const login = useCallback(async (email, password) => {
    await api.login(email, password);
    const u = await api.me();
    setUser(u);
    setStatus('authed');
    return u;
  }, []);

  const register = useCallback(async (email, password, displayName) => {
    await api.register(email, password, displayName);
    await api.login(email, password);
    const u = await api.me();
    setUser(u);
    setStatus('authed');
    return u;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setStatus('anon');
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const u = await api.me();
      setUser(u);
      setStatus('authed');
      return u;
    } catch (e) {
      setUser(null);
      setStatus('anon');
      return null;
    }
  }, []);

  const value = useMemo(() => ({ user, status, login, register, logout, refreshUser }), [user, status, login, register, logout, refreshUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
