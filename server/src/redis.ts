import { Redis, type RedisOptions } from 'ioredis';
import { resolveSecret } from './config.js';
import type { RedisConfig } from './types.js';

/** ioredis / BullMQ connection options derived from a stored RedisConfig. */
export function toRedisOptions(r: RedisConfig): RedisOptions {
  return {
    host: r.host,
    port: r.port,
    password: resolveSecret(r.password) || undefined,
    db: r.db,
    tls: r.tls ? {} : undefined,
    // Required by BullMQ; harmless for plain command clients.
    maxRetriesPerRequest: null,
  };
}

/** A long-lived client used for queue discovery (SCAN). */
export function createDiscoveryClient(r: RedisConfig): Redis {
  const client = new Redis({ ...toRedisOptions(r), lazyConnect: false });
  // Avoid crashing the process on transient connection errors.
  client.on('error', () => {});
  return client;
}

/** Connect, PING, and report server info. Throws on failure. */
export async function testConnection(r: RedisConfig): Promise<{ ping: string; version?: string }> {
  const client = new Redis({
    ...toRedisOptions(r),
    lazyConnect: true,
    connectTimeout: 5000,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
  });
  try {
    await client.connect();
    const ping = await client.ping();
    let version: string | undefined;
    try {
      const info = await client.info('server');
      version = /redis_version:([^\r\n]+)/.exec(info)?.[1];
    } catch {
      /* ignore */
    }
    return { ping, version };
  } finally {
    client.disconnect();
  }
}
