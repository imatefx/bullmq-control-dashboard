import type { Redis } from 'ioredis';

/**
 * Discover BullMQ queue names in a Redis instance by SCANning for the
 * per-queue meta key: `${prefix}:${queueName}:meta`.
 * Queue names may contain ':' so we strip the known head/tail instead of split.
 */
export async function discoverQueues(client: Redis, prefix: string): Promise<string[]> {
  const head = `${prefix}:`;
  const tail = ':meta';
  const match = `${prefix}:*:meta`;
  const names = new Set<string>();

  let cursor = '0';
  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', match, 'COUNT', 1000);
    cursor = next;
    for (const key of keys) {
      if (key.startsWith(head) && key.endsWith(tail)) {
        const name = key.slice(head.length, key.length - tail.length);
        if (name) names.add(name);
      }
    }
  } while (cursor !== '0');

  return [...names].sort();
}
