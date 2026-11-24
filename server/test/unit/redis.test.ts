import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redisConfig } from '../support/fixtures.js';

// Record what the code under test asks ioredis for, without opening sockets.
const h = vi.hoisted(() => {
  const behaviour = {
    connect: async () => {},
    info: async () => 'redis_version:7.2.4\r\ncluster_enabled:0\r\n',
  };
  class FakeClient {
    static instances: FakeClient[] = [];
    handlers: Record<string, unknown> = {};
    disconnect = vi.fn();
    constructor(...args: unknown[]) {
      (this.constructor as typeof FakeClient).instances.push(this);
      this.args = args;
    }
    args: unknown[];
    on(ev: string, fn: unknown) {
      this.handlers[ev] = fn;
      return this;
    }
    connect() {
      return behaviour.connect();
    }
    ping() {
      return Promise.resolve('PONG');
    }
    info() {
      return behaviour.info();
    }
  }
  class Redis extends FakeClient {
    static instances: Redis[] = [];
  }
  class Cluster extends FakeClient {
    static instances: Cluster[] = [];
    nodes() {
      return [{}, {}, {}];
    }
  }
  return { Redis, Cluster, behaviour };
});

vi.mock('ioredis', () => ({ Redis: h.Redis, Cluster: h.Cluster }));

const { createClient, testConnection } = await import('../../src/redis.js');

beforeEach(() => {
  h.Redis.instances = [];
  h.Cluster.instances = [];
  h.behaviour.connect = async () => {};
  h.behaviour.info = async () => 'redis_version:7.2.4\r\ncluster_enabled:0\r\n';
});

describe('createClient', () => {
  it('builds a standalone client with resolved secrets and BullMQ-safe options', () => {
    vi.stubEnv('QD_PW', 'from-env');
    createClient(redisConfig({ host: 'r', port: 6380, db: 3, password: '${QD_PW}', username: 'u', tls: true }));
    const [opts] = h.Redis.instances[0].args as [Record<string, unknown>];
    expect(opts).toMatchObject({
      host: 'r',
      port: 6380,
      db: 3,
      username: 'u',
      password: 'from-env',
      tls: {},
      maxRetriesPerRequest: null,
    });
    expect(h.Cluster.instances).toHaveLength(0);
  });

  it('swallows connection errors so they cannot crash the process', () => {
    createClient(redisConfig());
    expect(typeof h.Redis.instances[0].handlers.error).toBe('function');
  });

  it('omits empty credentials and TLS when not configured', () => {
    createClient(redisConfig());
    const [opts] = h.Redis.instances[0].args as [Record<string, unknown>];
    expect(opts.username).toBeUndefined();
    expect(opts.password).toBeUndefined();
    expect(opts.tls).toBeUndefined();
  });

  it('builds a cluster client from the seed node, keeping hostnames for TLS', () => {
    createClient(redisConfig({ host: 'cfg.cache.amazonaws.com', port: 6379, cluster: true, tls: true }));
    const [seeds, opts] = h.Cluster.instances[0].args as [unknown, any];
    expect(seeds).toEqual([{ host: 'cfg.cache.amazonaws.com', port: 6379 }]);
    expect(opts.redisOptions).toMatchObject({ tls: {}, maxRetriesPerRequest: null });
    const cb = vi.fn();
    opts.dnsLookup('node-1.cache.amazonaws.com', cb);
    expect(cb).toHaveBeenCalledWith(null, 'node-1.cache.amazonaws.com');
    expect(h.Redis.instances).toHaveLength(0);
  });
});

describe('testConnection', () => {
  it('reports ping and version for a standalone server, then disconnects', async () => {
    const r = await testConnection(redisConfig());
    expect(r).toEqual({ ping: 'PONG', version: '7.2.4', nodes: undefined, warning: undefined });
    const client = h.Redis.instances[0];
    expect(client.args[0]).toMatchObject({ lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1 });
    expect((client.args[0] as any).retryStrategy()).toBeNull();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('warns when a standalone connection points at a cluster-mode server', async () => {
    h.behaviour.info = async () => 'redis_version:7.0\r\ncluster_enabled:1\r\n';
    const r = await testConnection(redisConfig());
    expect(r.warning).toMatch(/Cluster mode/);
  });

  it('reports master count for cluster connections', async () => {
    const r = await testConnection(redisConfig({ cluster: true }));
    expect(r.nodes).toBe(3);
    const opts = h.Cluster.instances[0].args[1] as any;
    expect(opts.lazyConnect).toBe(true);
    expect(opts.clusterRetryStrategy()).toBeNull();
    expect(opts.redisOptions).toMatchObject({ connectTimeout: 5000, maxRetriesPerRequest: 1 });
  });

  it('still succeeds when INFO is not permitted', async () => {
    h.behaviour.info = async () => {
      throw new Error('NOPERM');
    };
    const r = await testConnection(redisConfig());
    expect(r).toMatchObject({ ping: 'PONG', version: undefined });
  });

  it('throws on connection failure and always disconnects', async () => {
    h.behaviour.connect = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(testConnection(redisConfig())).rejects.toThrow('ECONNREFUSED');
    expect(h.Redis.instances[0].disconnect).toHaveBeenCalled();
  });
});
