import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthResponse, PublicUser } from '@/types';
import { api, errorMessage, getToken, setToken, setUnauthorizedHandler } from '@/lib/api';
import { closeSocket, refreshSocketAuth } from '@/lib/socket';

interface AuthContextValue {
  user: PublicUser | null;
  token: string | null;
  loading: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  login: (username: string, password: string) => Promise<PublicUser>;
  loginWithGoogle: (payload: { googleId: string; email?: string; avatar?: string }) => Promise<PublicUser>;
  register: (input: { username: string; password: string; email?: string }) => Promise<PublicUser>;
  logout: () => void;
  updateUser: (patch: Partial<PublicUser> & { password?: string; currentPassword?: string }) => Promise<PublicUser>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((payload: AuthResponse) => {
    setToken(payload.token);
    setTokenState(payload.token);
    setUser(payload.user);
    refreshSocketAuth();
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setUser(null);
    closeSocket();
  }, []);

  // Restore the session on boot.
  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get<{ user: PublicUser }>('/auth/me');
      setUser(data.user);
    } catch {
      logout();
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    setUnauthorizedHandler(() => logout());
    void refresh();
    return () => setUnauthorizedHandler(null);
  }, [logout, refresh]);

  const login = useCallback(
    async (username: string, password: string) => {
      try {
        const { data } = await api.post<AuthResponse>('/auth/login', { username, password });
        applySession(data);
        return data.user;
      } catch (err) {
        throw new Error(errorMessage(err, 'Login failed'));
      }
    },
    [applySession],
  );

  const loginWithGoogle = useCallback(
    async (payload: { googleId: string; email?: string; avatar?: string }) => {
      const { data } = await api.post<AuthResponse>('/auth/login', payload);
      applySession(data);
      return data.user;
    },
    [applySession],
  );

  const register = useCallback(
    async (input: { username: string; password: string; email?: string }) => {
      const { data } = await api.post<AuthResponse>('/auth/register', input);
      applySession(data);
      return data.user;
    },
    [applySession],
  );

  const updateUser = useCallback(
    async (patch: Partial<PublicUser> & { password?: string; currentPassword?: string }) => {
      const { data } = await api.put<{ user: PublicUser; token?: string }>('/auth/me', patch);
      if (data.token) {
        setToken(data.token);
        setTokenState(data.token);
      }
      setUser(data.user);
      return data.user;
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      isAdmin: user?.role === 'admin' || user?.role === 'owner',
      isOwner: user?.role === 'owner',
      login,
      loginWithGoogle,
      register,
      logout,
      updateUser,
      refresh,
    }),
    [user, token, loading, login, loginWithGoogle, register, logout, updateUser, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
