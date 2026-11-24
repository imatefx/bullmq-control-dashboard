import { Cluster } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { discoverQueues } from '../../src/discovery.js';
import type { RedisClient } from '../../src/redis.js';

/** A fake node whose SCAN returns the given pages in order. */
function fakeNode(pages: string[][]) {
  let i = 0;
  return {
    scan: vi.fn(async () => {
      const keys = pages[i] ?? [];
      i++;
      return [i >= pages.length ? '0' : String(i), keys] as [string, string[]];
    }),
  };
}

describe('discoverQueues', () => {
  it('extracts names from meta keys and sorts them', async () => {
    const node = fakeNode([['bull:emails:meta', 'bull:billing:meta']]);
    expect(await discoverQueues(node as unknown as RedisClient, 'bull')).toEqual(['billing', 'emails']);
    expect(node.scan).toHaveBeenCalledWith('0', 'MATCH', 'bull:*:meta', 'COUNT', 1000);
  });

  it('keeps ":" inside queue names (longer producer prefixes)', async () => {
    const node = fakeNode([['bull:260:v1.bulkSync:meta', 'bull:a:b:c:meta']]);
    expect(await discoverQueues(node as unknown as RedisClient, 'bull')).toEqual([
      '260:v1.bulkSync',
      'a:b:c',
    ]);
  });

  it('follows the SCAN cursor across pages and dedupes', async () => {
    const node = fakeNode([['bull:a:meta'], ['bull:b:meta', 'bull:a:meta'], ['bull:c:meta']]);
    expect(await discoverQueues(node as unknown as RedisClient, 'bull')).toEqual(['a', 'b', 'c']);
    expect(node.scan).toHaveBeenCalledTimes(3);
  });

  it('uses a custom prefix and ignores empty names', async () => {
    const node = fakeNode([['myapp:jobs:meta', 'myapp::meta']]);
    expect(await discoverQueues(node as unknown as RedisClient, 'myapp')).toEqual(['jobs']);
  });

  it('scans every master in cluster mode', async () => {
    const m1 = fakeNode([['bull:a:meta']]);
    const m2 = fakeNode([['bull:b:meta', 'bull:a:meta']]);
    // Like ioredis: nodes() is empty until the slot map loads, which ping() waits for.
    let slotsLoaded = false;
    const cluster = Object.create(Cluster.prototype);
    cluster.ping = vi.fn(async () => {
      slotsLoaded = true;
      return 'PONG';
    });
    cluster.nodes = vi.fn(() => (slotsLoaded ? [m1, m2] : []));

    expect(await discoverQueues(cluster, 'bull')).toEqual(['a', 'b']);
    expect(cluster.nodes).toHaveBeenCalledWith('master');
  });
});
