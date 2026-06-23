import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useActiveServer } from '@/context/ServerContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const STATES = ['active', 'waiting', 'delayed', 'completed', 'failed', 'paused'] as const;

export function OverviewPage() {
  const { activeId } = useActiveServer();
  const { data } = useQuery({
    queryKey: ['overview', activeId],
    queryFn: () => api.overview(activeId ?? undefined),
    refetchInterval: 5000,
  });
  const { data: connections = [] } = useQuery({
    queryKey: ['connections'],
    queryFn: api.listConnections,
  });

  const rows = data?.queues ?? [];
  const totals = STATES.reduce(
    (acc, s) => {
      acc[s] = rows.reduce((sum, r) => sum + (r.counts?.[s] ?? 0), 0);
      return acc;
    },
    {} as Record<string, number>,
  );
  const connName = (id: string) => connections.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Overview</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATES.map((s) => (
          <Card key={s}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {s}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{totals[s] ?? 0}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Live queues ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Server</TableHead>
                <TableHead>Queue</TableHead>
                {STATES.map((s) => (
                  <TableHead key={s} className="text-right capitalize">
                    {s}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2 + STATES.length} className="py-8 text-center text-muted-foreground">
                    No enabled queues yet. Enable queues on the Queues page.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={`${r.connId}:${r.name}`}>
                  <TableCell className="text-muted-foreground">{connName(r.connId)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.name}</TableCell>
                  {STATES.map((s) => (
                    <TableCell key={s} className="text-right tabular-nums">
                      {r.counts?.[s] ?? (r.error ? '—' : 0)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
