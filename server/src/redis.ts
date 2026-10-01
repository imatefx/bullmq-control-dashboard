import { Cluster, Redis, type ClusterOptions, type RedisOptions } from 'ioredis';
import { resolveSecret } from './config.js';
import type { RedisConfig } from './types.js';

export type RedisClient = Redis | Cluster;

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
  // Avoid crashing the process on transient connection errors.
  client.on('error', () => {});
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
  client.on('error', () => {});
  try {
    await client.connect();
    const ping = await client.ping();
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
