import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Plug, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Connection, type ConnectionInput } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const EMPTY: ConnectionInput = {
  name: '',
  redis: { host: '127.0.0.1', port: 6379, password: '', db: 0, tls: false, prefix: 'bull' },
  autoRefresh: true,
  refreshIntervalMs: 15000,
};

function statusBadge(c: Connection) {
  const s = c.status?.state ?? 'connecting';
  if (s === 'ok')
    return (
      <Badge variant="success">
        ok · {c.status.registered ?? 0}/{c.status.discovered ?? 0}
      </Badge>
    );
  if (s === 'error') return <Badge variant="destructive">error</Badge>;
  return <Badge variant="warning">connecting</Badge>;
}

export function ConnectionsPage() {
  const qc = useQueryClient();
  const { data: connections = [] } = useQuery({
    queryKey: ['connections'],
    queryFn: api.listConnections,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [form, setForm] = useState<ConnectionInput>(EMPTY);
  const [testing, setTesting] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['connections'] });

  const save = useMutation({
    mutationFn: (input: ConnectionInput) =>
      editing ? api.updateConnection(editing.id, input) : api.createConnection(input),
    onSuccess: () => {
      toast.success(editing ? 'Connection updated' : 'Connection added');
      setOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteConnection(id),
    onSuccess: () => {
      toast.success('Connection removed');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openAdd() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }
  function openEdit(c: Connection) {
    setEditing(c);
    setForm({
      name: c.name,
      redis: { ...c.redis, password: '' },
      autoRefresh: c.autoRefresh,
      refreshIntervalMs: c.refreshIntervalMs,
    });
    setOpen(true);
  }

  async function test() {
    setTesting(true);
    try {
      const r = await api.testConnection({ redis: form.redis });
      if (r.ok) toast.success(`Connected · Redis ${r.version ?? ''} (${r.ping})`);
      else toast.error(`Failed: ${r.error}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Connections</h1>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4" /> Add connection
        </Button>
      </div>

      {connections.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No Redis connections yet. Add one to start discovering queues.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {connections.map((c) => (
          <Card key={c.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="truncate">{c.name}</CardTitle>
              {statusBadge(c)}
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="font-mono text-xs text-muted-foreground">
                {c.redis.host}:{c.redis.port} · db{c.redis.db} · prefix “{c.redis.prefix}”
                {c.redis.tls ? ' · tls' : ''}
                {c.redis.hasPassword ? ' · 🔒' : ''}
              </div>
              {c.status?.state === 'error' && (
                <div className="text-xs text-destructive">{c.status.error}</div>
              )}
              <div className="text-xs text-muted-foreground">
                auto-refresh {c.autoRefresh ? `every ${Math.round(c.refreshIntervalMs / 1000)}s` : 'off'}
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => remove.mutate(c.id)}
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit connection' : 'Add connection'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Name">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Production"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Host">
                <Input
                  value={form.redis.host}
                  onChange={(e) => setForm({ ...form, redis: { ...form.redis, host: e.target.value } })}
                />
              </Field>
              <Field label="Port">
                <Input
                  type="number"
                  value={form.redis.port}
                  onChange={(e) =>
                    setForm({ ...form, redis: { ...form.redis, port: Number(e.target.value) } })
                  }
                />
              </Field>
            </div>
            <Field label={editing ? 'Password (leave blank to keep)' : 'Password (optional)'}>
              <Input
                type="password"
                value={form.redis.password}
                onChange={(e) =>
                  setForm({ ...form, redis: { ...form.redis, password: e.target.value } })
                }
                placeholder="supports ${ENV_VAR}"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="DB">
                <Input
                  type="number"
                  value={form.redis.db}
                  onChange={(e) =>
                    setForm({ ...form, redis: { ...form.redis, db: Number(e.target.value) } })
                  }
                />
              </Field>
              <Field label="Key prefix">
                <Input
                  value={form.redis.prefix}
                  onChange={(e) =>
                    setForm({ ...form, redis: { ...form.redis, prefix: e.target.value } })
                  }
                />
              </Field>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label>TLS</Label>
              <Switch
                checked={form.redis.tls}
                onCheckedChange={(v) => setForm({ ...form, redis: { ...form.redis, tls: v } })}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label>Auto-refresh queues</Label>
                <p className="text-xs text-muted-foreground">Re-scan Redis on an interval</p>
              </div>
              <Switch
                checked={form.autoRefresh}
                onCheckedChange={(v) => setForm({ ...form, autoRefresh: v })}
              />
            </div>
            {form.autoRefresh && (
              <Field label="Refresh interval (ms)">
                <Input
                  type="number"
                  value={form.refreshIntervalMs}
                  onChange={(e) => setForm({ ...form, refreshIntervalMs: Number(e.target.value) })}
                />
              </Field>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={test} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
              Test
            </Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
