import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api, type QueueRow } from '@/lib/api';
import { useActiveServer } from '@/context/ServerContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function QueuesPage() {
  const qc = useQueryClient();
  const { activeId } = useActiveServer();
  const { data: connections = [] } = useQuery({
    queryKey: ['connections'],
    queryFn: api.listConnections,
  });

  const connId = activeId ?? connections[0]?.id ?? null;
  const conn = connections.find((c) => c.id === connId);

  const { data, isLoading } = useQuery({
    queryKey: ['queues', connId],
    queryFn: () => api.listQueues(connId!),
    enabled: !!connId,
  });

  const [filter, setFilter] = useState('');
  const invalidate = () => connId && qc.invalidateQueries({ queryKey: ['queues', connId] });

  const upsert = useMutation({
    mutationFn: (ov: Partial<QueueRow> & { name: string }) => api.upsertQueue(connId!, ov),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const bulk = useMutation({
    mutationFn: (patch: { enabled?: boolean; delimiter?: string; readOnlyMode?: boolean }) =>
      api.bulkQueues(connId!, { patch }),
    onSuccess: () => {
      toast.success('Applied to all queues');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rescan = useMutation({
    mutationFn: () => api.rescan(connId!),
    onSuccess: () => {
      toast.success('Rescanned');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const q = (data?.queues ?? []).slice();
    if (!filter) return q;
    const f = filter.toLowerCase();
    return q.filter((r) => r.name.toLowerCase().includes(f) || r.displayName.toLowerCase().includes(f));
  }, [data, filter]);

  if (!connId) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Add a connection first.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Queues · {conn?.name}</h1>
          <p className="text-sm text-muted-foreground">
            {data?.discoveredCount ?? 0} discovered ·{' '}
            {rows.filter((r) => r.enabled).length} enabled
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="w-48 pl-8"
              placeholder="Filter queues"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={() => bulk.mutate({ enabled: true })} disabled={bulk.isPending}>
            <CheckCheck className="h-4 w-4" /> Enable all
          </Button>
          <Button variant="outline" onClick={() => rescan.mutate()} disabled={rescan.isPending}>
            <RefreshCw className={`h-4 w-4 ${rescan.isPending ? 'animate-spin' : ''}`} /> Rescan
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Queue</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Display name</TableHead>
                <TableHead className="w-24">Delimiter</TableHead>
                <TableHead className="w-24 text-center">Read-only</TableHead>
                <TableHead className="w-24 text-center">Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No queues discovered.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <QueueEditRow
                  key={row.name}
                  row={row}
                  onSave={(patch) => upsert.mutate({ name: row.name, ...patch })}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function QueueEditRow({
  row,
  onSave,
}: {
  row: QueueRow;
  onSave: (patch: Partial<QueueRow>) => void;
}) {
  const [displayName, setDisplayName] = useState(row.displayName);
  const [delimiter, setDelimiter] = useState(row.delimiter);

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        <div className="flex items-center gap-2">
          {row.name}
          {!row.discovered && <Badge variant="warning">missing</Badge>}
          {row.registered && <Badge variant="success">live</Badge>}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{row.group || '—'}</TableCell>
      <TableCell>
        <Input
          value={displayName}
          placeholder={row.name}
          onChange={(e) => setDisplayName(e.target.value)}
          onBlur={() => displayName !== row.displayName && onSave({ displayName, delimiter })}
          className="h-8"
        />
      </TableCell>
      <TableCell>
        <Input
          value={delimiter}
          placeholder="."
          onChange={(e) => setDelimiter(e.target.value)}
          onBlur={() => delimiter !== row.delimiter && onSave({ displayName, delimiter })}
          className="h-8"
        />
      </TableCell>
      <TableCell className="text-center">
        <Switch
          checked={row.readOnlyMode}
          onCheckedChange={(v) => onSave({ readOnlyMode: v, displayName, delimiter })}
        />
      </TableCell>
      <TableCell className="text-center">
        <Switch
          checked={row.enabled}
          onCheckedChange={(v) => onSave({ enabled: v, displayName, delimiter })}
        />
      </TableCell>
    </TableRow>
  );
}
