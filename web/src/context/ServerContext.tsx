import { createContext, useContext, useState, type ReactNode } from 'react';

type ServerContextValue = {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
};

const ServerContext = createContext<ServerContextValue | null>(null);

export const ALL_SERVERS = 'all';

const STORAGE_KEY = 'active-server-id';

export function ServerProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveIdState] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );

  const setActiveId = (id: string | null) => {
    setActiveIdState(id);
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  };

  return <ServerContext.Provider value={{ activeId, setActiveId }}>{children}</ServerContext.Provider>;
}

export function useActiveServer() {
  const ctx = useContext(ServerContext);
  if (!ctx) throw new Error('useActiveServer must be used within ServerProvider');
  return ctx;
}
