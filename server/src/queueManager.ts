import { Queue, type ConnectionOptions } from 'bullmq';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { combinedBoard, destroyBoard, ensureBoard } from './bullboard.js';
import { getConfig } from './config.js';
import { discoverQueues } from './discovery.js';
import { broadcast, type ConnStatus } from './events.js';
import { createClient, type RedisClient } from './redis.js';
import type { Config, Connection, QueueOverride } from './types.js';

type Entry = {
  queue: Queue;
  adapter: BullMQAdapter;
  combinedAdapter?: BullMQAdapter;
  override: QueueOverride;
};

const registered = new Map<string, Map<string, Entry>>();
const clients = new Map<string, RedisClient>(); // one per connection, shared by its queues
const lastDiscovered = new Map<string, string[]>();
const statuses = new Map<string, ConnStatus>();
const timers = new Map<string, NodeJS.Timeout>();
const combinedOwner = new Map<string, string>(); // queueName -> owning connId in combined board
const generations = new Map<string, number>(); // bumped on teardown; stale syncs bail out
const syncing = new Set<string>(); // connIds with a sync in flight

// The shared client queues commands until Redis answers, so an unreachable host would
// otherwise leave discovery (and everything awaiting it) pending forever.
const DISCOVERY_TIMEOUT_MS = 10_000;

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

function generationOf(connId: string): number {
  return generations.get(connId) ?? 0;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Wait for the client to be connected without queueing a command on it. */
function waitForReady(client: RedisClient, ms: number, message: string): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  let onReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    onReady = resolve;
    client.once('ready', onReady);
  });
  return withTimeout(ready, ms, message).finally(() => client.off('ready', onReady));
}

function ensureClient(conn: Connection): RedisClient {
  let client = clients.get(conn.id);
  if (!client) {
    client = createClient(conn.redis);
    clients.set(conn.id, client);
  }
  return client;
}

/**
 * BullMQ rejects ':' in queue names, but discovery reports names like
 * `260:v1.bulkSync` when a producer used a longer prefix (`bull:260`).
 * Everything before the last ':' belongs to the prefix; the Redis keys are identical.
 */
function splitQueueName(name: string): { head: string; queueName: string } {
  const i = name.lastIndexOf(':');
  return i < 0 ? { head: '', queueName: name } : { head: name.slice(0, i), queueName: name.slice(i + 1) };
}

// bull-board keys queues by `${adapter prefix}${queue.name}`; restore the full discovered name.
function boardPrefix(name: string): string | undefined {
  const { head } = splitQueueName(name);
  return head ? `${head}:` : undefined;
}

function makeAdapter(queue: Queue, ov: QueueOverride): BullMQAdapter {
  return new BullMQAdapter(queue, {
    prefix: boardPrefix(ov.name),
    displayName: ov.displayName || undefined,
    delimiter: ov.delimiter || undefined,
    description: ov.description || undefined,
    readOnlyMode: ov.readOnlyMode,
  });
}

function makeCombinedAdapter(queue: Queue, conn: Connection, ov: QueueOverride): BullMQAdapter {
  return new BullMQAdapter(queue, {
    prefix: boardPrefix(ov.name),
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
  const { head, queueName } = splitQueueName(name);
  const queue = new Queue(queueName, {
    // A shared client: BullMQ won't close it on queue.close(); teardownConnection does.
    // bullmq pins its own ioredis copy; it detects clients by shape, so only the types differ.
    connection: ensureClient(conn) as unknown as ConnectionOptions,
    prefix: head ? `${conn.redis.prefix}:${head}` : conn.redis.prefix,
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
  syncing.add(conn.id);
  try {
    await doSync(conn);
  } finally {
    syncing.delete(conn.id);
  }
}

async function doSync(conn: Connection): Promise<void> {
  const generation = generationOf(conn.id);
  ensureBoard(conn.id);
  // Keep the last known status (ok or error) during re-syncs instead of flickering to 'connecting'.
  if (!statuses.has(conn.id)) setStatus(conn.id, { state: 'connecting' });

  const client = ensureClient(conn);
  const timeoutMessage = `Redis did not respond within ${DISCOVERY_TIMEOUT_MS / 1000}s (${conn.redis.host}:${conn.redis.port})`;
  let discovered: string[];
  try {
    await waitForReady(client, DISCOVERY_TIMEOUT_MS, timeoutMessage);
    discovered = await withTimeout(
      discoverQueues(client, conn.redis.prefix),
      DISCOVERY_TIMEOUT_MS,
      timeoutMessage,
    );
  } catch (err: any) {
    // The connection was torn down (edited/deleted) while we waited; its new incarnation owns the status.
    if (generationOf(conn.id) !== generation) return;
    setStatus(conn.id, { state: 'error', error: err?.message ?? String(err) });
    return;
  }
  if (generationOf(conn.id) !== generation) return;
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

  // Add newly desired queues. One bad queue must not take down the connection (or the process).
  const failed: string[] = [];
  for (const [name, ov] of desired) {
    if (current.has(name)) continue;
    try {
      await addEntry(conn, name, ov, current);
    } catch (err: any) {
      console.error(`[queue-dashboard] ${conn.name}: cannot register queue "${name}":`, err?.message ?? err);
      failed.push(`${name}: ${err?.message ?? String(err)}`);
    }
  }

  setStatus(conn.id, {
    state: 'ok',
    error: failed.length ? `Failed to register ${failed.join('; ')}` : undefined,
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
    // Skip the tick while a previous sync is still waiting on Redis, so they don't pile up.
    if (syncing.has(conn.id)) return;
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
  generations.set(connId, generationOf(connId) + 1);
  stopAutoRefresh(connId);
  const current = registered.get(connId);
  if (current) {
    for (const [name, entry] of [...current]) await removeEntry(connId, name, entry, current);
  }
  registered.delete(connId);
  lastDiscovered.delete(connId);
  statuses.delete(connId);
  const client = clients.get(connId);
  if (client) {
    client.disconnect();
    clients.delete(connId);
  }
  destroyBoard(connId);
}

/** Bring a single connection fully online (board + sync + auto-refresh). */
export async function activateConnection(conn: Connection): Promise<void> {
  ensureBoard(conn.id);
  // Start auto-refresh first so a connection that is down at activation keeps retrying.
  startAutoRefresh(conn);
  await syncConnection(conn);
}

/**
 * Create every board up front, then sync connections in the background so a slow or
 * unreachable Redis never delays startup (or the other connections).
 */
export async function initFromConfig(config: Config): Promise<void> {
  combinedBoard();
  for (const conn of config.connections) ensureBoard(conn.id);
  for (const conn of config.connections) void activateConnection(conn);
}

export async function reinitAll(config: Config): Promise<void> {
  // Include connections that never synced: they still hold a client and a retry timer.
  const known = new Set([...registered.keys(), ...clients.keys(), ...timers.keys()]);
  for (const connId of known) await teardownConnection(connId);
  await initFromConfig(config);
}
