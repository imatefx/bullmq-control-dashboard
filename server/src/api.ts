import { Router } from 'express';
import { nanoid } from 'nanoid';
import {
  exportConfig,
  getConfig,
  saveConfig,
  updateConfig,
} from './config.js';
import { broadcast } from './events.js';
import {
  activateConnection,
  getDiscovered,
  getQueueHandles,
  getStatus,
  isRegistered,
  reinitAll,
  syncConnection,
  teardownConnection,
} from './queueManager.js';
import { testConnection } from './redis.js';
import {
  ConfigSchema,
  ConnectionSchema,
  QueueOverrideSchema,
  RedisConfigSchema,
  type Connection,
  type QueueOverride,
} from './types.js';

export const api = Router();

function redact(conn: Connection) {
  const { password, ...redis } = conn.redis;
  return {
    id: conn.id,
    name: conn.name,
    redis: { ...redis, hasPassword: !!password },
    autoRefresh: conn.autoRefresh,
    refreshIntervalMs: conn.refreshIntervalMs,
    queues: conn.queues,
    status: getStatus(conn.id),
  };
}

function deriveGroup(ov: QueueOverride): string {
  if (ov.delimiter && ov.name.includes(ov.delimiter)) return ov.name.split(ov.delimiter)[0];
  return '';
}

function findConn(id: string): Connection | undefined {
  return getConfig().connections.find((c) => c.id === id);
}

// ---- connections ----

api.get('/connections', (_req, res) => {
  res.json(getConfig().connections.map(redact));
});

api.post('/connections', async (req, res) => {
  const parsed = z_connectionInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const conn = ConnectionSchema.parse({ ...parsed.value, id: `conn_${nanoid(8)}` });
  await updateConfig((cfg) => {
    cfg.connections.push(conn);
  });
  await activateConnection(conn);
  res.status(201).json(redact(conn));
});

api.put('/connections/:id', async (req, res) => {
  const existing = findConn(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const parsed = z_connectionInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  // Preserve existing password when the client sends an empty/absent one.
  const password =
    parsed.value.redis.password && parsed.value.redis.password.length > 0
      ? parsed.value.redis.password
      : existing.redis.password;

  const updated = ConnectionSchema.parse({
    ...existing,
    ...parsed.value,
    id: existing.id,
    redis: { ...parsed.value.redis, password },
    queues: existing.queues,
  });

  const cfg = await updateConfig((c) => {
    const i = c.connections.findIndex((x) => x.id === updated.id);
    c.connections[i] = updated;
  });
  await teardownConnection(updated.id);
  await activateConnection(updated);
  res.json(redact(findConn(updated.id)!));
  void cfg;
});

api.delete('/connections/:id', async (req, res) => {
  if (!findConn(req.params.id)) return res.status(404).json({ error: 'not found' });
  await teardownConnection(req.params.id);
  await updateConfig((cfg) => {
    cfg.connections = cfg.connections.filter((c) => c.id !== req.params.id);
  });
  broadcast({ type: 'config:changed' });
  res.status(204).end();
});

api.post('/connections/:id/test', async (req, res) => {
  // Test either a stored connection or an ad-hoc redis config in the body.
  const redis = req.body?.redis
    ? RedisConfigSchema.safeParse(req.body.redis)
    : findConn(req.params.id)
      ? { success: true as const, data: findConn(req.params.id)!.redis }
      : null;
  if (!redis) return res.status(404).json({ error: 'not found' });
  if (!redis.success) return res.status(400).json({ error: 'invalid redis config' });
  try {
    const info = await testConnection(redis.data);
    res.json({ ok: true, ...info });
  } catch (err: any) {
    res.json({ ok: false, error: err?.message ?? String(err) });
  }
});

// ---- queues ----

api.get('/connections/:id/queues', (req, res) => {
  const conn = findConn(req.params.id);
  if (!conn) return res.status(404).json({ error: 'not found' });
  const discovered = getDiscovered(conn.id);
  const overrides = new Map(conn.queues.map((q) => [q.name, q]));

  const rows = discovered.map((name) => {
    const ov = overrides.get(name) ?? QueueOverrideSchema.parse({ name });
    return {
      ...ov,
      group: deriveGroup(ov),
      registered: isRegistered(conn.id, name),
      discovered: true,
    };
  });
  // Configured queues that are no longer present in Redis.
  for (const q of conn.queues) {
    if (!discovered.includes(q.name)) {
      rows.push({ ...q, group: deriveGroup(q), registered: false, discovered: false });
    }
  }
  res.json({ status: getStatus(conn.id), discoveredCount: discovered.length, queues: rows });
});

api.post('/connections/:id/queues', async (req, res) => {
  const conn = findConn(req.params.id);
  if (!conn) return res.status(404).json({ error: 'not found' });
  // Accept a partial patch and merge it onto the existing (or default) override.
  const parsed = QueueOverrideSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const patch = parsed.data;
  if (!patch.name) return res.status(400).json({ error: 'name is required' });
  const name = patch.name;

  await updateConfig((cfg) => {
    const c = cfg.connections.find((x) => x.id === conn.id)!;
    const i = c.queues.findIndex((q) => q.name === name);
    const base = i >= 0 ? c.queues[i] : QueueOverrideSchema.parse({ name });
    const merged = QueueOverrideSchema.parse({ ...base, ...patch });
    if (i >= 0) c.queues[i] = merged;
    else c.queues.push(merged);
  });
  await syncConnection(findConn(conn.id)!);
  res.json({ ok: true });
});

api.post('/connections/:id/queues/bulk', async (req, res) => {
  const conn = findConn(req.params.id);
  if (!conn) return res.status(404).json({ error: 'not found' });
  const names: string[] = Array.isArray(req.body?.names) ? req.body.names : getDiscovered(conn.id);
  const patch = req.body?.patch ?? {};

  await updateConfig((cfg) => {
    const c = cfg.connections.find((x) => x.id === conn.id)!;
    for (const name of names) {
      let q = c.queues.find((x) => x.name === name);
      if (!q) {
        q = QueueOverrideSchema.parse({ name });
        c.queues.push(q);
      }
      if (typeof patch.enabled === 'boolean') q.enabled = patch.enabled;
      if (typeof patch.delimiter === 'string') q.delimiter = patch.delimiter;
      if (typeof patch.readOnlyMode === 'boolean') q.readOnlyMode = patch.readOnlyMode;
    }
  });
  await syncConnection(findConn(conn.id)!);
  res.json({ ok: true });
});

api.post('/connections/:id/rescan', async (req, res) => {
  const conn = findConn(req.params.id);
  if (!conn) return res.status(404).json({ error: 'not found' });
  await syncConnection(conn);
  res.json({ ok: true, status: getStatus(conn.id) });
});

// ---- overview / health ----

api.get('/overview', async (req, res) => {
  const connId = typeof req.query.connId === 'string' ? req.query.connId : undefined;
  const handles = getQueueHandles(connId);
  const rows = await Promise.all(
    handles.map(async (h) => {
      try {
        const counts = await h.queue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
          'paused',
        );
        return { connId: h.connId, name: h.name, counts, error: null };
      } catch (err: any) {
        return { connId: h.connId, name: h.name, counts: null, error: err?.message ?? String(err) };
      }
    }),
  );
  res.json({ queues: rows });
});

// ---- config import/export ----

api.get('/config/export', (req, res) => {
  // Only admins may pull plaintext secrets; readers always get a redacted export.
  const includeSecrets = req.role === 'admin' && req.query.includeSecrets === 'true';
  const data = exportConfig(includeSecrets);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="queue-dashboard.config.json"');
  res.send(JSON.stringify(data, null, 2));
});

api.post('/config/import', async (req, res) => {
  const parsed = ConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await saveConfig(parsed.data);
  await reinitAll(parsed.data);
  broadcast({ type: 'config:changed' });
  res.json({ ok: true, connections: parsed.data.connections.length });
});

// ---- input validation helper ----

function z_connectionInput(
  body: unknown,
): { ok: true; value: { name: string; redis: any; autoRefresh: boolean; refreshIntervalMs: number } } | { ok: false; error: any } {
  const schema = ConnectionSchema.omit({ id: true, queues: true });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.flatten() };
  return { ok: true, value: parsed.data as any };
}
