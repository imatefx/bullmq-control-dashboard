import { Cluster } from 'ioredis';
import type { RedisClient } from './redis.js';

/**
 * Discover BullMQ queue names in a Redis instance by SCANning for the
 * per-queue meta key: `${prefix}:${queueName}:meta`.
 * Queue names may contain ':' so we strip the known head/tail instead of split.
 * In cluster mode SCAN is per node, so every master is scanned.
 */
export async function discoverQueues(client: RedisClient, prefix: string): Promise<string[]> {
  const head = `${prefix}:`;
  const tail = ':meta';
  const match = `${prefix}:*:meta`;
  const names = new Set<string>();

  let nodes: RedisClient[] = [client];
  if (client instanceof Cluster) {
    // Waits (via the offline queue) until the slot map is loaded, so nodes() is populated.
    await client.ping();
    nodes = client.nodes('master');
  }

  for (const node of nodes) {
    let cursor = '0';
    do {
      const [next, keys] = await node.scan(cursor, 'MATCH', match, 'COUNT', 1000);
      cursor = next;
      for (const key of keys) {
        if (key.startsWith(head) && key.endsWith(tail)) {
          const name = key.slice(head.length, key.length - tail.length);
          if (name) names.add(name);
        }
      }
    } while (cursor !== '0');
  }

  return [...names].sort();
}
