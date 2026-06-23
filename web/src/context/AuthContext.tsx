import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Me } from '@/lib/api';

type AuthValue = {
  me?: Me;
  role?: Me['role'];
  username?: string;
  isAdmin: boolean;
  isLoading: boolean;
};

const AuthContext = createContext<AuthValue>({ isAdmin: false, isLoading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: api.getMe,
    staleTime: Infinity,
    retry: false,
  });

  const value: AuthValue = {
    me,
    role: me?.role,
    username: me?.username,
    // Until /api/me resolves, assume not-admin so write controls stay hidden.
    isAdmin: me?.role === 'admin',
    isLoading,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
