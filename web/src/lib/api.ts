export type ConnStatus = {
  state: 'ok' | 'error' | 'connecting';
  error?: string;
  discovered?: number;
  registered?: number;
  lastSync?: number;
};

export type RedisInfo = {
  host: string;
  port: number;
  db: number;
  tls: boolean;
  prefix: string;
  hasPassword: boolean;
};

export type Connection = {
  id: string;
  name: string;
  redis: RedisInfo;
  autoRefresh: boolean;
  refreshIntervalMs: number;
  queues: QueueOverride[];
  status: ConnStatus;
};

export type QueueOverride = {
  name: string;
  displayName: string;
  delimiter: string;
  readOnlyMode: boolean;
  enabled: boolean;
  description: string;
};

export type QueueRow = QueueOverride & {
  group: string;
  registered: boolean;
  discovered: boolean;
};

export type ConnectionInput = {
  name: string;
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
    tls: boolean;
    prefix: string;
  };
  autoRefresh: boolean;
  refreshIntervalMs: number;
};

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listConnections: () => req<Connection[]>('/api/connections'),
  createConnection: (input: ConnectionInput) =>
    req<Connection>('/api/connections', { method: 'POST', body: JSON.stringify(input) }),
  updateConnection: (id: string, input: ConnectionInput) =>
    req<Connection>(`/api/connections/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteConnection: (id: string) => req<void>(`/api/connections/${id}`, { method: 'DELETE' }),
  testConnection: (payload: { id?: string; redis?: ConnectionInput['redis'] }) =>
    req<{ ok: boolean; ping?: string; version?: string; error?: string }>(
      `/api/connections/${payload.id ?? 'adhoc'}/test`,
      { method: 'POST', body: JSON.stringify(payload.redis ? { redis: payload.redis } : {}) },
    ),

  listQueues: (id: string) =>
    req<{ status: ConnStatus; discoveredCount: number; queues: QueueRow[] }>(
      `/api/connections/${id}/queues`,
    ),
  upsertQueue: (id: string, ov: Partial<QueueOverride> & { name: string }) =>
    req<{ ok: boolean }>(`/api/connections/${id}/queues`, {
      method: 'POST',
      body: JSON.stringify(ov),
    }),
  bulkQueues: (
    id: string,
    body: { names?: string[]; patch: { enabled?: boolean; delimiter?: string; readOnlyMode?: boolean } },
  ) =>
    req<{ ok: boolean }>(`/api/connections/${id}/queues/bulk`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  rescan: (id: string) =>
    req<{ ok: boolean; status: ConnStatus }>(`/api/connections/${id}/rescan`, { method: 'POST' }),

  overview: (connId?: string) =>
    req<{ queues: { connId: string; name: string; counts: Record<string, number> | null; error: string | null }[] }>(
      `/api/overview${connId ? `?connId=${connId}` : ''}`,
    ),

  importConfig: (cfg: unknown) =>
    req<{ ok: boolean; connections: number }>('/api/config/import', {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),
  exportUrl: (includeSecrets: boolean) =>
    `/api/config/export?includeSecrets=${includeSecrets ? 'true' : 'false'}`,
};
