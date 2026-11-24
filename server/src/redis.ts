import { Cluster, Redis, type ClusterOptions, type RedisOptions } from 'ioredis';
import { resolveSecret } from './config.js';
import type { RedisConfig } from './types.js';

export type RedisClient = Redis | Cluster;

// ioredis reports the server's actual reason (WRONGPASS, NOAUTH, ECONNREFUSED, ...) only via
// 'error' events; the promises just reject with 'Connection is closed.'. Keep the latest one.
const lastErrors = new WeakMap<RedisClient, Error>();

function trackErrors(client: RedisClient): void {
  // Listening also keeps transient connection errors from crashing the process.
  client.on('error', (err: Error) => lastErrors.set(client, err));
  // Once connected, older errors no longer describe the connection.
  client.on('ready', () => lastErrors.delete(client));
}

/** The most recent connection error reported by the client, if any. */
export function getLastError(client: RedisClient): Error | undefined {
  return lastErrors.get(client);
}

/** Per-node options shared by standalone and cluster clients. */
function nodeOptions(r: RedisConfig): RedisOptions {
  return {
    username: resolveSecret(r.username) || undefined,
    password: resolveSecret(r.password) || undefined,
    tls: r.tls ? {} : undefined,
    // Required by BullMQ; harmless for plain command clients.
    maxRetriesPerRequest: null,
  };
}

function standaloneOptions(r: RedisConfig): RedisOptions {
  return { host: r.host, port: r.port, db: r.db, ...nodeOptions(r) };
}

function clusterOptions(r: RedisConfig, node: RedisOptions = {}): ClusterOptions {
  return {
    // ElastiCache (and other TLS clusters) issue certificates for hostnames, not node IPs,
    // so skip ioredis' DNS resolution and connect by the hostname the cluster advertises.
    dnsLookup: (address, callback) => callback(null, address),
    redisOptions: { ...nodeOptions(r), ...node },
  };
}

/**
 * The long-lived client for a connection, used for queue discovery (SCAN) and shared by
 * all of its BullMQ queues. Cluster mode needs one client that follows MOVED/ASK redirects.
 */
export function createClient(r: RedisConfig): RedisClient {
  const client = r.cluster
    ? new Cluster([{ host: r.host, port: r.port }], clusterOptions(r))
    : new Redis(standaloneOptions(r));
  trackErrors(client);
  return client;
}

/** Connect, PING, and report server info. Throws on failure. */
export async function testConnection(
  r: RedisConfig,
): Promise<{ ping: string; version?: string; nodes?: number; warning?: string }> {
  const client: RedisClient = r.cluster
    ? new Cluster([{ host: r.host, port: r.port }], {
        ...clusterOptions(r, { connectTimeout: 5000, maxRetriesPerRequest: 1 }),
        lazyConnect: true,
        clusterRetryStrategy: () => null,
      })
    : new Redis({
        ...standaloneOptions(r),
        lazyConnect: true,
        connectTimeout: 5000,
        retryStrategy: () => null,
        maxRetriesPerRequest: 1,
      });
  trackErrors(client);
  try {
    let ping: string;
    try {
      await client.connect();
      ping = await client.ping();
    } catch (err) {
      // Prefer the server's reason (e.g. WRONGPASS) over ioredis' generic 'Connection is closed.'
      throw getLastError(client) ?? err;
    }
    let version: string | undefined;
    let warning: string | undefined;
    try {
      const info = await client.info();
      version = /redis_version:([^\r\n]+)/.exec(info)?.[1];
      if (!r.cluster && /cluster_enabled:1/.test(info)) {
        warning = 'Server runs in cluster mode — enable "Cluster mode" for this connection';
      }
    } catch {
      /* ignore */
    }
    const nodes = client instanceof Cluster ? client.nodes('master').length : undefined;
    return { ping, version, nodes, warning };
  } finally {
    client.disconnect();
  }
}
