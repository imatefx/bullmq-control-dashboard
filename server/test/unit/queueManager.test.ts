import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../src/types.js';
import { connection } from '../support/fixtures.js';

const h = vi.hoisted(() => {
  class FakeRedis extends (require('node:events').EventEmitter as typeof EventEmitter) {
    status = 'ready';
    keys: string[] = [];
    disconnect = vi.fn();
    async scan() {
      return ['0', this.keys] as [string, string[]];
    }
  }
  const clients: FakeRedis[] = [];
  const queues: { name: string; opts: any; close: ReturnType<typeof vi.fn> }[] = [];
  const adapters: { queue: unknown; opts: any }[] = [];
  const boards = new Map<string, { addQueue: ReturnType<typeof vi.fn>; removeQueue: ReturnType<typeof vi.fn> }>();
  const state = { nextClient: () => new FakeRedis(), failQueue: new Set<string>() };
  return { FakeRedis, clients, queues, adapters, boards, state };
});

vi.mock('../../src/redis.js', () => ({
  createClient: () => {
    const c = h.state.nextClient();
    h.clients.push(c);
    return c;
  },
}));

vi.mock('bullmq', () => ({
  Queue: class {
    close = vi.fn(async () => {});
    constructor(
      public name: string,
      public opts: any,
    ) {
      // Real BullMQ rejects ':' in queue names — the bug splitQueueName exists to avoid.
      if (name.includes(':')) throw new Error('Queue name cannot contain :');
      if (h.state.failQueue.has(name)) throw new Error(`bad queue ${name}`);
      h.queues.push(this as any);
    }
  },
}));

vi.mock('@bull-board/api/bullMQAdapter', () => ({
  BullMQAdapter: class {
    constructor(
      public queue: unknown,
      public opts: any,
    ) {
      h.adapters.push(this as any);
    }
  },
}));

vi.mock('../../src/bullboard.js', () => {
  const ensureBoard = (id: string) => {
    if (!h.boards.has(id)) h.boards.set(id, { addQueue: vi.fn(), removeQueue: vi.fn() });
    return h.boards.get(id)!;
  };
  return {
    ensureBoard,
    combinedBoard: () => ensureBoard('all'),
    destroyBoard: (id: string) => h.boards.delete(id),
  };
});

vi.mock('../../src/events.js', () => ({ broadcast: vi.fn() }));

const qm = await import('../../src/queueManager.js');
const { broadcast } = await import('../../src/events.js');
const { saveConfig } = await import('../../src/config.js');

let seq = 0;
function conn(keys: string[], over: Partial<Connection> = {}) {
  const id = `c${++seq}`;
  const c = connection({ id, name: `Conn ${id}`, ...over });
  h.state.nextClient = () => Object.assign(new h.FakeRedis(), { keys });
  return c;
}
const enabled = (name: string, extra = {}) => ({
  name,
  enabled: true,
  displayName: '',
  delimiter: '',
  readOnlyMode: false,
  description: '',
  ...extra,
});

beforeEach(() => {
  h.clients.length = 0;
  h.queues.length = 0;
  h.adapters.length = 0;
  h.boards.clear();
  h.state.failQueue.clear();
  vi.mocked(broadcast).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('syncConnection', () => {
  it('registers only queues that are both enabled and discovered', async () => {
    const c = conn(['bull:a:meta', 'bull:b:meta', 'bull:c:meta'], {
      queues: [enabled('a'), { ...enabled('b'), enabled: false }, enabled('gone')],
    });
    await qm.syncConnection(c);

    expect(qm.getDiscovered(c.id)).toEqual(['a', 'b', 'c']);
    expect(qm.isRegistered(c.id, 'a')).toBe(true);
    expect(qm.isRegistered(c.id, 'b')).toBe(false);
    expect(qm.isRegistered(c.id, 'gone')).toBe(false);
    expect(qm.getStatus(c.id)).toMatchObject({ state: 'ok', discovered: 3, registered: 1, error: undefined });
    expect(qm.getQueueHandles(c.id).map((q) => q.name)).toEqual(['a']);
    expect(broadcast).toHaveBeenCalledWith({ type: 'queues:changed', connId: c.id });
  });

  it('splits ":" names into a longer BullMQ prefix and restores the board name', async () => {
    const c = conn(['bull:260:v1.bulkSync:meta'], { queues: [enabled('260:v1.bulkSync')] });
    await qm.syncConnection(c);

    const q = h.queues.at(-1)!;
    expect(qm.isRegistered(c.id, '260:v1.bulkSync')).toBe(true);
    expect(q.name).toBe('v1.bulkSync');
    expect(q.opts.prefix).toBe('bull:260');
    expect(q.opts.connection).toBe(h.clients.at(-1)); // shared client
    // Per-connection and combined adapters both restore the full name.
    const forQueue = h.adapters.filter((a) => a.queue === q);
    expect(forQueue).toHaveLength(2);
    for (const a of forQueue) expect(a.opts.prefix).toBe('260:');
  });

  it('splits on the last ":" for names with several', async () => {
    const c = conn(['bull:a:b:c:meta'], { queues: [enabled('a:b:c')] });
    await qm.syncConnection(c);
    expect(qm.getStatus(c.id).error).toBeUndefined();
    const q = h.queues.at(-1)!;
    expect(q.name).toBe('c');
    expect(q.opts.prefix).toBe('bull:a:b');
    expect(h.adapters.filter((a) => a.queue === q).every((a) => a.opts.prefix === 'a:b:')).toBe(true);
  });

  it('shares one client across all queues of a connection', async () => {
    const c = conn(['bull:a:meta', 'bull:b:meta'], { queues: [enabled('a'), enabled('b')] });
    await qm.syncConnection(c);
    await qm.syncConnection(c);
    expect(h.clients).toHaveLength(1);
    expect(new Set(h.queues.map((q) => q.opts.connection)).size).toBe(1);
  });

  it('adds a queue to the combined board only once across connections', async () => {
    const c1 = conn(['bull:shared:meta'], { queues: [enabled('shared')] });
    await qm.syncConnection(c1);
    const c2 = conn(['bull:shared:meta'], { queues: [enabled('shared')] });
    await qm.syncConnection(c2);

    expect(h.boards.get('all')!.addQueue).toHaveBeenCalledTimes(1);
    expect(h.boards.get(c1.id)!.addQueue).toHaveBeenCalledTimes(1);
    expect(h.boards.get(c2.id)!.addQueue).toHaveBeenCalledTimes(1);
    const combined = h.adapters.find((a) => a.opts.displayName === `${c1.name} / shared`);
    expect(combined).toBeDefined();
  });

  it('isolates a queue that fails to register', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.state.failQueue.add('bad');
    const c = conn(['bull:good:meta', 'bull:bad:meta'], { queues: [enabled('good'), enabled('bad')] });
    await qm.syncConnection(c);

    expect(qm.isRegistered(c.id, 'good')).toBe(true);
    expect(qm.getStatus(c.id)).toMatchObject({
      state: 'ok',
      registered: 1,
      error: expect.stringContaining('Failed to register bad: bad queue bad'),
    });
  });

  it('rebuilds the adapter when overrides change and closes disabled queues', async () => {
    const c = conn(['bull:a:meta'], { queues: [enabled('a')] });
    await qm.syncConnection(c);
    const board = h.boards.get(c.id)!;
    const queue = h.queues.at(-1)!;

    await qm.syncConnection({ ...c, queues: [enabled('a', { displayName: 'Alpha', readOnlyMode: true })] });
    expect(board.removeQueue).toHaveBeenCalledTimes(1);
    expect(h.adapters.at(-1)!.opts).toMatchObject({ readOnlyMode: true });
    expect(h.queues).toHaveLength(1); // same Queue instance reused

    await qm.syncConnection({ ...c, queues: [] });
    expect(queue.close).toHaveBeenCalled();
    expect(qm.isRegistered(c.id, 'a')).toBe(false);
  });

  it('reports an error instead of hanging when Redis never becomes ready', async () => {
    vi.useFakeTimers();
    const c = conn([], { redis: { host: '10.255.255.1', port: 6379 } as any });
    h.state.nextClient = () => Object.assign(new h.FakeRedis(), { status: 'connecting' });

    const done = qm.syncConnection(c);
    expect(qm.getStatus(c.id).state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    expect(qm.getStatus(c.id)).toEqual({
      state: 'error',
      error: 'Redis did not respond within 10s (10.255.255.1:6379)',
    });
    // The 'ready' listener must not leak.
    expect(h.clients.at(-1)!.listenerCount('ready')).toBe(0);
  });

  it('times out when Redis is connected but discovery never answers', async () => {
    vi.useFakeTimers();
    const c = conn([]);
    h.state.nextClient = () =>
      Object.assign(new h.FakeRedis(), { scan: () => new Promise(() => {}) });
    const done = qm.syncConnection(c);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(qm.getStatus(c.id)).toMatchObject({
      state: 'error',
      error: expect.stringMatching(/did not respond within 10s/),
    });
  });

  it('recovers once a slow Redis becomes ready', async () => {
    const c = conn(['bull:a:meta'], { queues: [enabled('a')] });
    h.state.nextClient = () => Object.assign(new h.FakeRedis(), { status: 'connecting', keys: ['bull:a:meta'] });
    const done = qm.syncConnection(c);
    const client = h.clients.at(-1)!;
    client.status = 'ready';
    client.emit('ready');
    await done;
    expect(qm.getStatus(c.id).state).toBe('ok');
  });

  it('drops the result of a sync whose connection was torn down meanwhile', async () => {
    vi.useFakeTimers();
    const c = conn([]);
    h.state.nextClient = () => Object.assign(new h.FakeRedis(), { status: 'connecting' });
    const done = qm.syncConnection(c);
    await qm.teardownConnection(c.id);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    // No stale 'error' status written for the old incarnation.
    expect(qm.getStatus(c.id)).toEqual({ state: 'connecting' });
  });
});

describe('teardownConnection', () => {
  it('closes queues, disconnects the client and destroys the board', async () => {
    // A name no other test uses, so this connection owns it on the combined board.
    const c = conn(['bull:teardown-only:meta'], { queues: [enabled('teardown-only')] });
    await qm.syncConnection(c);
    const client = h.clients.at(-1)!;
    const queue = h.queues.at(-1)!;

    await qm.teardownConnection(c.id);
    expect(queue.close).toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
    expect(h.boards.has(c.id)).toBe(false);
    expect(qm.getDiscovered(c.id)).toEqual([]);
    expect(h.boards.get('all')!.removeQueue).toHaveBeenCalled();
  });
});

describe('auto-refresh and startup', () => {
  it('initFromConfig returns without waiting on an unreachable Redis', async () => {
    vi.useFakeTimers();
    const c = conn([], { autoRefresh: true, refreshIntervalMs: 5000 });
    h.state.nextClient = () => Object.assign(new h.FakeRedis(), { status: 'connecting' });
    await qm.initFromConfig({ version: 1, connections: [c] });
    expect(h.boards.has(c.id)).toBe(true);
    expect(h.boards.has('all')).toBe(true);
    await qm.teardownConnection(c.id);
  });

  it('re-syncs on an interval using the latest config, skipping while a sync is in flight', async () => {
    vi.useFakeTimers();
    const c = conn(['bull:a:meta'], { autoRefresh: true, refreshIntervalMs: 5000 });
    await saveConfig({ version: 1, connections: [c] });
    await qm.activateConnection(c);
    expect(qm.isRegistered(c.id, 'a')).toBe(false);

    // Config changes after activation; the next tick must pick it up.
    await saveConfig({ version: 1, connections: [{ ...c, queues: [enabled('a')] }] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(qm.isRegistered(c.id, 'a')).toBe(true);

    // Redis goes quiet: the t=10s tick's sync hangs until its 10s timeout (t=20s).
    // The t=15s tick fires while it is in flight and must not start another.
    const client = h.clients.at(-1)!;
    const scan = vi.spyOn(client, 'scan').mockImplementation(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(5000); // t=10s: hung sync starts
    expect(scan).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9000); // t=19s: the t=15s tick is skipped
    expect(scan).toHaveBeenCalledTimes(1);

    await qm.teardownConnection(c.id);
  });

  it('does not schedule refreshes when auto-refresh is off', async () => {
    vi.useFakeTimers();
    const c = conn([], { autoRefresh: false });
    qm.startAutoRefresh(c);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reinitAll tears down every known connection, including never-synced ones', async () => {
    vi.useFakeTimers();
    const live = conn(['bull:a:meta'], { queues: [enabled('a')] });
    await qm.syncConnection(live);
    const liveClient = h.clients.at(-1)!;

    const down = conn([], { autoRefresh: true });
    h.state.nextClient = () => Object.assign(new h.FakeRedis(), { status: 'connecting' });
    void qm.activateConnection(down);
    const downClient = h.clients.at(-1)!;

    await qm.reinitAll({ version: 1, connections: [] });
    expect(liveClient.disconnect).toHaveBeenCalled();
    expect(downClient.disconnect).toHaveBeenCalled();
    // Only the stalled sync's 10s timeout remains (no refresh interval); it then expires harmlessly.
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(qm.getStatus(down.id)).toEqual({ state: 'connecting' });
  });
});
