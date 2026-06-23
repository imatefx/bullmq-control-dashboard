import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Database, ListTree, LayoutDashboard, Settings, Activity, Server } from 'lucide-react';
import { api } from '@/lib/api';
import { ALL_SERVERS, useActiveServer } from '@/context/ServerContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

const NAV = [
  { to: '/', label: 'Overview', icon: Activity, end: true },
  { to: '/connections', label: 'Connections', icon: Database },
  { to: '/queues', label: 'Queues', icon: ListTree },
  { to: '/board', label: 'Board', icon: LayoutDashboard },
  { to: '/config', label: 'Config', icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { activeId, setActiveId } = useActiveServer();
  const { data: connections = [] } = useQuery({
    queryKey: ['connections'],
    queryFn: api.listConnections,
    refetchInterval: 10000,
  });

  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="flex shrink-0 flex-col border-b border-border bg-card md:h-screen md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-5 py-4 text-lg font-semibold">
          <Server className="h-5 w-5 text-primary" />
          Queue Dashboard
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border bg-card/50 px-4 py-3 md:px-6">
          <div className="text-sm text-muted-foreground">Central queue management</div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">Active server</span>
            <Select
              value={activeId ?? ALL_SERVERS}
              onValueChange={(v) => setActiveId(v === ALL_SERVERS ? null : v)}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All servers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SERVERS}>All servers</SelectItem>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
