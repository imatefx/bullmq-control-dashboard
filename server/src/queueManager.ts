import { Queue } from 'bullmq';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import type { Redis } from 'ioredis';
import { combinedBoard, destroyBoard, ensureBoard } from './bullboard.js';
import { getConfig } from './config.js';
import { discoverQueues } from './discovery.js';
import { broadcast, type ConnStatus } from './events.js';
import { createDiscoveryClient, toRedisOptions } from './redis.js';
import type { Config, Connection, QueueOverride } from './types.js';

type Entry = {
  queue: Queue;
  adapter: BullMQAdapter;
  combinedAdapter?: BullMQAdapter;
  override: QueueOverride;
};

const registered = new Map<string, Map<string, Entry>>();
const discoveryClients = new Map<string, Redis>();
const lastDiscovered = new Map<string, string[]>();
const statuses = new Map<string, ConnStatus>();
const timers = new Map<string, NodeJS.Timeout>();
const combinedOwner = new Map<string, string>(); // queueName -> owning connId in combined board

// ---- queries used by the API ----

export function getDiscovered(connId: string): string[] {
  return lastDiscovered.get(connId) ?? [];
}

export function getStatus(connId: string): ConnStatus {
  return statuses.get(connId) ?? { state: 'connecting' };
}

export function isRegistered(connId: string, name: string): boolean {
  return registered.get(connId)?.has(name) ?? false;
}

export function getQueueHandles(connId?: string): { connId: string; name: string; queue: Queue }[] {
  const out: { connId: string; name: string; queue: Queue }[] = [];
  for (const [id, map] of registered) {
    if (connId && id !== connId) continue;
    for (const [name, entry] of map) out.push({ connId: id, name, queue: entry.queue });
  }
  return out;
}

// ---- internals ----

function setStatus(connId: string, status: ConnStatus): void {
  statuses.set(connId, status);
  broadcast({ type: 'connection:status', connId, status });
}

function ensureDiscoveryClient(conn: Connection): Redis {
  let client = discoveryClients.get(conn.id);
  if (!client) {
    client = createDiscoveryClient(conn.redis);
    discoveryClients.set(conn.id, client);
  }
  return client;
}

function makeAdapter(queue: Queue, ov: QueueOverride): BullMQAdapter {
  return new BullMQAdapter(queue, {
    displayName: ov.displayName || undefined,
    delimiter: ov.delimiter || undefined,
    description: ov.description || undefined,
    readOnlyMode: ov.readOnlyMode,
  });
}

function makeCombinedAdapter(queue: Queue, conn: Connection, ov: QueueOverride): BullMQAdapter {
  return new BullMQAdapter(queue, {
    displayName: `${conn.name} / ${ov.displayName || ov.name}`,
    delimiter: ov.delimiter || undefined,
    readOnlyMode: ov.readOnlyMode,
  });
}

async function addEntry(
  conn: Connection,
  name: string,
  ov: QueueOverride,
  current: Map<string, Entry>,
): Promise<void> {
  const queue = new Queue(name, {
    connection: toRedisOptions(conn.redis),
    prefix: conn.redis.prefix,
  });
  const adapter = makeAdapter(queue, ov);
  ensureBoard(conn.id).addQueue(adapter);

  let combinedAdapter: BullMQAdapter | undefined;
  if (!combinedOwner.has(name)) {
    combinedAdapter = makeCombinedAdapter(queue, conn, ov);
    combinedBoard().addQueue(combinedAdapter);
    combinedOwner.set(name, conn.id);
  }
  current.set(name, { queue, adapter, combinedAdapter, override: ov });
}

async function removeEntry(
  connId: string,
  name: string,
  entry: Entry,
  current: Map<string, Entry>,
): Promise<void> {
  ensureBoard(connId).removeQueue(entry.adapter);
  if (entry.combinedAdapter) {
    combinedBoard().removeQueue(entry.combinedAdapter);
    combinedOwner.delete(name);
  }
  await entry.queue.close().catch(() => {});
  current.delete(name);
}

export async function syncConnection(conn: Connection): Promise<void> {
  ensureBoard(conn.id);
  setStatus(conn.id, { state: 'connecting' });

  const client = ensureDiscoveryClient(conn);
  let discovered: string[];
  try {
    discovered = await discoverQueues(client, conn.redis.prefix);
  } catch (err: any) {
    setStatus(conn.id, { state: 'error', error: err?.message ?? String(err) });
    return;
  }
  lastDiscovered.set(conn.id, discovered);

  const board = ensureBoard(conn.id);
  const current = registered.get(conn.id) ?? new Map<string, Entry>();
  registered.set(conn.id, current);

  const desired = new Map<string, QueueOverride>();
  for (const q of conn.queues) {
    if (q.enabled && discovered.includes(q.name)) desired.set(q.name, q);
  }

  // Reconcile existing entries.
  for (const [name, entry] of [...current]) {
    const ov = desired.get(name);
    if (!ov) {
      await removeEntry(conn.id, name, entry, current);
      continue;
    }
    if (JSON.stringify(ov) !== JSON.stringify(entry.override)) {
      board.removeQueue(entry.adapter);
      entry.adapter = makeAdapter(entry.queue, ov);
      board.addQueue(entry.adapter);
      if (entry.combinedAdapter) {
        combinedBoard().removeQueue(entry.combinedAdapter);
        entry.combinedAdapter = makeCombinedAdapter(entry.queue, conn, ov);
        combinedBoard().addQueue(entry.combinedAdapter);
      }
      entry.override = ov;
    }
  }

  // Add newly desired queues.
  for (const [name, ov] of desired) {
    if (!current.has(name)) await addEntry(conn, name, ov, current);
  }

  setStatus(conn.id, {
    state: 'ok',
    discovered: discovered.length,
    registered: current.size,
    lastSync: Date.now(),
  });
  broadcast({ type: 'queues:changed', connId: conn.id });
}

export function startAutoRefresh(conn: Connection): void {
  stopAutoRefresh(conn.id);
  if (!conn.autoRefresh) return;
  const timer = setInterval(() => {
    // Always re-read the latest connection (queues/overrides change over time).
    const latest = getConfig().connections.find((c) => c.id === conn.id);
    if (latest) void syncConnection(latest);
  }, conn.refreshIntervalMs);
  timer.unref?.();
  timers.set(conn.id, timer);
}

export function stopAutoRefresh(connId: string): void {
  const timer = timers.get(connId);
  if (timer) clearInterval(timer);
  timers.delete(connId);
}

export async function teardownConnection(connId: string): Promise<void> {
  stopAutoRefresh(connId);
  const current = registered.get(connId);
  if (current) {
    for (const [name, entry] of [...current]) await removeEntry(connId, name, entry, current);
  }
  registered.delete(connId);
  lastDiscovered.delete(connId);
  statuses.delete(connId);
  const client = discoveryClients.get(connId);
  if (client) {
    client.disconnect();
    discoveryClients.delete(connId);
  }
  destroyBoard(connId);
}

/** Bring a single connection fully online (board + sync + auto-refresh). */
export async function activateConnection(conn: Connection): Promise<void> {
  ensureBoard(conn.id);
  await syncConnection(conn);
  startAutoRefresh(conn);
}

export async function initFromConfig(config: Config): Promise<void> {
  combinedBoard();
  for (const conn of config.connections) await activateConnection(conn);
}

export async function reinitAll(config: Config): Promise<void> {
  for (const connId of [...registered.keys()]) await teardownConnection(connId);
  await initFromConfig(config);
}
