import { createContext, useContext, useState, type ReactNode } from 'react';

type ServerContextValue = {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
};

const ServerContext = createContext<ServerContextValue | null>(null);

export const ALL_SERVERS = 'all';

export function ServerProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  return <ServerContext.Provider value={{ activeId, setActiveId }}>{children}</ServerContext.Provider>;
}

export function useActiveServer() {
  const ctx = useContext(ServerContext);
  if (!ctx) throw new Error('useActiveServer must be used within ServerProvider');
  return ctx;
}
