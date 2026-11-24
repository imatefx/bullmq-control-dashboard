import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { saveConfig } from '../../src/config.js';
import { reinitAll } from '../../src/queueManager.js';
import { basicAuth } from '../support/fixtures.js';
import { flushRedis, redisAddr, seedQueues } from '../support/redis.js';

const ADMIN = basicAuth('admin', 'adminpw');
const READER = basicAuth('reader', 'readerpw');

let server: Server;
let base: string;

async function call(method: string, path: string, opts: { auth?: string | null; body?: unknown } = {}) {
  const auth = opts.auth === undefined ? ADMIN : opts.auth;
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(auth ? { authorization: auth } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function addConnection(over: Record<string, unknown> = {}) {
  const res = await call('POST', '/api/connections', {
    body: { name: 'Local', redis: { ...redisAddr(), password: '' }, autoRefresh: false, ...over },
  });
  expect(res.status).toBe(201);
  return res.json;
}

beforeAll(async () => {
  // Set directly: vi.stubEnv is reset after each test (unstubEnvs), but these must last the file.
  Object.assign(process.env, {
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'adminpw',
    READER_USERNAME: 'reader',
    READER_PASSWORD: 'readerpw',
  });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await reinitAll({ version: 1, connections: [] });
  await saveConfig({ version: 1, connections: [] });
  await flushRedis();
  await seedQueues([
    { name: 'emails', jobs: 3 },
    { name: 'billing', jobs: 1 },
    { name: 'v1.bulkSync', prefix: 'bull:260', jobs: 2 },
    { name: 'deep', prefix: 'bull:x:y', jobs: 5 },
  ]);
});

afterAll(async () => {
  await reinitAll({ version: 1, connections: [] });
  await new Promise((r) => server.close(r));
});

describe('auth', () => {
  it('challenges unauthenticated requests', async () => {
    const res = await call('GET', '/api/connections', { auth: null });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic/);
  });

  it('reports who is signed in', async () => {
    expect((await call('GET', '/api/me')).json).toEqual({ role: 'admin', username: 'admin' });
    expect((await call('GET', '/api/me', { auth: READER })).json).toEqual({ role: 'reader', username: 'reader' });
  });

  it('lets readers read but not write', async () => {
    expect((await call('GET', '/api/connections', { auth: READER })).status).toBe(200);
    const res = await call('POST', '/api/connections', { auth: READER, body: { name: 'x', redis: redisAddr() } });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('read-only');
  });
});

describe('connections', () => {
  it('creates a connection, syncs it, and never returns the password', async () => {
    const conn = await addConnection({ redis: { ...redisAddr(), password: 'topsecret' } });
    expect(conn.id).toMatch(/^conn_/);
    expect(conn.redis.password).toBeUndefined();
    expect(conn.redis.hasPassword).toBe(true);

    const list = await call('GET', '/api/connections');
    expect(list.json).toHaveLength(1);
    expect(JSON.stringify(list.json)).not.toContain('topsecret');
  });

  it('validates input', async () => {
    expect((await call('POST', '/api/connections', { body: { name: '' } })).status).toBe(400);
    expect((await call('PUT', '/api/connections/nope', { body: {} })).status).toBe(404);
    expect((await call('DELETE', '/api/connections/nope')).status).toBe(404);
  });

  it('keeps the stored password when an edit sends a blank one', async () => {
    const conn = await addConnection({ redis: { ...redisAddr(), password: 'keepme' } });
    const res = await call('PUT', `/api/connections/${conn.id}`, {
      body: { name: 'Renamed', redis: { ...redisAddr(), password: '' }, autoRefresh: false },
    });
    expect(res.status).toBe(200);
    expect(res.json.name).toBe('Renamed');
    expect(res.json.redis.hasPassword).toBe(true);
  });

  it('tests ad-hoc and stored connections', async () => {
    const adhoc = await call('POST', '/api/connections/new/test', { body: { redis: redisAddr() } });
    expect(adhoc.json).toMatchObject({ ok: true, ping: 'PONG' });

    const bad = await call('POST', '/api/connections/new/test', { body: { redis: { host: '127.0.0.1', port: 1 } } });
    expect(bad.json.ok).toBe(false);
    expect(bad.json.error).toBeTruthy();

    const conn = await addConnection();
    expect((await call('POST', `/api/connections/${conn.id}/test`)).json.ok).toBe(true);
    expect((await call('POST', '/api/connections/missing/test')).status).toBe(404);
    expect((await call('POST', '/api/connections/x/test', { body: { redis: { port: 'x' } } })).status).toBe(400);
  });

  it('explains a wrong password in the test result and the connection status', async () => {
    const bad = { ...redisAddr(), username: 'nobody', password: 'wrong' };
    const tested = await call('POST', '/api/connections/new/test', { body: { redis: bad } });
    expect(tested.json).toEqual({ ok: false, error: expect.stringMatching(/^WRONGPASS/) });

    // A saved connection with bad credentials times out, and says why.
    const conn = await addConnection({ redis: bad });
    expect(conn.status).toEqual({
      state: 'error',
      error: expect.stringMatching(/did not respond within 10s .*: WRONGPASS/),
    });
  }, 30_000);

  it('deletes a connection', async () => {
    const conn = await addConnection();
    expect((await call('DELETE', `/api/connections/${conn.id}`)).status).toBe(204);
    expect((await call('GET', '/api/connections')).json).toEqual([]);
  });
});

describe('queues', () => {
  it('lists discovered queues, enables one, and exposes live job counts', async () => {
    const conn = await addConnection();
    const listed = await call('GET', `/api/connections/${conn.id}/queues`);
    expect(listed.json.discoveredCount).toBe(4);
    expect(listed.json.queues.map((q: any) => q.name).sort()).toEqual(['260:v1.bulkSync', 'billing', 'emails', 'x:y:deep']);
    expect(listed.json.queues.every((q: any) => !q.enabled && !q.registered)).toBe(true);

    expect(
      (await call('POST', `/api/connections/${conn.id}/queues`, { body: { name: 'emails', enabled: true } })).status,
    ).toBe(200);
    const after = await call('GET', `/api/connections/${conn.id}/queues`);
    expect(after.json.queues.find((q: any) => q.name === 'emails')).toMatchObject({ enabled: true, registered: true });

    const overview = await call('GET', `/api/overview?connId=${conn.id}`);
    expect(overview.json.queues).toEqual([
      expect.objectContaining({ name: 'emails', counts: expect.objectContaining({ waiting: 3 }), error: null }),
    ]);
  });

  it('registers ":" queues against the right Redis keys', async () => {
    const conn = await addConnection();
    await call('POST', `/api/connections/${conn.id}/queues/bulk`, {
      body: { names: ['260:v1.bulkSync', 'x:y:deep'], patch: { enabled: true } },
    });
    const overview = await call('GET', '/api/overview');
    expect(overview.json.queues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '260:v1.bulkSync', counts: expect.objectContaining({ waiting: 2 }) }),
        expect.objectContaining({ name: 'x:y:deep', counts: expect.objectContaining({ waiting: 5 }) }),
      ]),
    );
    const board = await call('GET', `/board/${conn.id}/api/queues`);
    expect(board.json.queues.map((q: any) => q.name).sort()).toEqual(['260:v1.bulkSync', 'x:y:deep']);
  });

  it('bulk-enables everything and serves the bull-board UI', async () => {
    const conn = await addConnection();
    await call('POST', `/api/connections/${conn.id}/queues/bulk`, { body: { patch: { enabled: true } } });
    const listed = await call('GET', `/api/connections/${conn.id}/queues`);
    expect(listed.json.queues.every((q: any) => q.registered)).toBe(true);

    const board = await call('GET', `/board/${conn.id}/`);
    expect(board.status).toBe(200);
    expect(board.text).toContain('<html');

    const boardApi = await call('GET', `/board/${conn.id}/api/queues`);
    expect(boardApi.json.queues.map((q: any) => q.name).sort()).toEqual(['260:v1.bulkSync', 'billing', 'emails', 'x:y:deep']);
  });

  it('picks up new queues on rescan and flags ones that disappear', async () => {
    const conn = await addConnection();
    await call('POST', `/api/connections/${conn.id}/queues`, { body: { name: 'billing', enabled: true } });
    await flushRedis();
    await seedQueues([{ name: 'fresh' }]);

    const rescan = await call('POST', `/api/connections/${conn.id}/rescan`);
    expect(rescan.json.status).toMatchObject({ state: 'ok', discovered: 1, registered: 0 });
    const listed = await call('GET', `/api/connections/${conn.id}/queues`);
    expect(listed.json.queues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'fresh', discovered: true }),
        expect.objectContaining({ name: 'billing', discovered: false, registered: false }),
      ]),
    );
  });

  it('rejects queue patches without a name', async () => {
    const conn = await addConnection();
    expect((await call('POST', `/api/connections/${conn.id}/queues`, { body: { enabled: true } })).status).toBe(400);
  });
});

describe('config import/export', () => {
  it('redacts secrets except for admins who ask', async () => {
    await addConnection({ redis: { ...redisAddr(), password: 'pw1' } });
    const redacted = await call('GET', '/api/config/export');
    expect(redacted.json.connections[0].redis.password).toBe('');
    const full = await call('GET', '/api/config/export?includeSecrets=true');
    expect(full.json.connections[0].redis.password).toBe('pw1');
    const reader = await call('GET', '/api/config/export?includeSecrets=true', { auth: READER });
    expect(reader.json.connections[0].redis.password).toBe('');
  });

  it('imports a config and brings its connections online', async () => {
    const res = await call('POST', '/api/config/import', {
      body: {
        version: 1,
        connections: [
          { id: 'imported', name: 'Imported', redis: redisAddr(), autoRefresh: false, queues: [{ name: 'emails', enabled: true }] },
        ],
      },
    });
    expect(res.json).toEqual({ ok: true, connections: 1 });
    await expect
      .poll(async () => (await call('GET', '/api/connections/imported/queues')).json.queues.find((q: any) => q.name === 'emails')?.registered)
      .toBe(true);
    expect((await call('POST', '/api/config/import', { body: { version: 2 } })).status).toBe(400);
  });
});
