import { beforeAll, describe, expect, it } from 'vitest';
import { discoverQueues } from '../../src/discovery.js';
import { createClient, testConnection } from '../../src/redis.js';
import { redisConfig } from '../support/fixtures.js';
import { flushRedis, redisAddr, seedQueues } from '../support/redis.js';

beforeAll(async () => {
  await flushRedis();
  await seedQueues([
    { name: 'emails', jobs: 2 },
    { name: 'billing' },
    // A producer using a longer prefix: keys look like bull:260:v1.bulkSync:*
    { name: 'v1.bulkSync', prefix: 'bull:260' },
    { name: 'reports', prefix: 'other' },
    { name: 'deep', prefix: 'bull:x:y' },
  ]);
});

describe('discoverQueues against real Redis', () => {
  it('finds BullMQ queues under the prefix, including ":" names', async () => {
    const client = createClient(redisConfig(redisAddr()));
    try {
      expect(await discoverQueues(client, 'bull')).toEqual(['260:v1.bulkSync', 'billing', 'emails', 'x:y:deep']);
      expect(await discoverQueues(client, 'other')).toEqual(['reports']);
      expect(await discoverQueues(client, 'nothing-here')).toEqual([]);
    } finally {
      client.disconnect();
    }
  });
});

describe('testConnection against real Redis', () => {
  it('pings and reports the server version', async () => {
    const r = await testConnection(redisConfig(redisAddr()));
    expect(r.ping).toBe('PONG');
    expect(r.version).toMatch(/^7\./);
    expect(r.warning).toBeUndefined();
  });

  it('fails fast for a closed port', async () => {
    const started = Date.now();
    await expect(testConnection(redisConfig({ host: '127.0.0.1', port: 1 }))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(6000);
  });

  it('rejects wrong credentials', async () => {
    // Known gap: ioredis surfaces 'Connection is closed.' rather than the WRONGPASS reply,
    // so the UI cannot tell bad credentials from a dropped connection.
    await expect(
      testConnection(redisConfig({ ...redisAddr(), username: 'nobody', password: 'wrong' })),
    ).rejects.toThrow();
  });
});
