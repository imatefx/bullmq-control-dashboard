// Boots the e2e stack in plain Node (outside Playwright's TS loader):
//   Redis (Testcontainers, or opt-in TEST_REDIS_HOST/PORT/DB) → seeded BullMQ queues → node server/dist.
// Prints one JSON line `{"ready":true,...}` when up; SIGTERM/SIGINT tears everything down.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT ?? 3011);

for (const p of ['server/dist/index.js', 'web/dist/index.html']) {
  if (!existsSync(path.join(ROOT, p))) {
    console.error(`${p} missing — run \`npm run build\` first`);
    process.exit(1);
  }
}

let container;
// Test-specific names only: this database is flushed, so never pick up a generic REDIS_HOST.
let host = process.env.TEST_REDIS_HOST;
let port = Number(process.env.TEST_REDIS_PORT ?? 6379);
const db = host ? Number(process.env.TEST_REDIS_DB ?? 15) : 0;
if (!host) {
  const { RedisContainer } = await import('@testcontainers/redis');
  container = await new RedisContainer('redis:7-alpine').start();
  host = container.getHost();
  port = container.getMappedPort(6379);
}

// Start from a known state so reruns against an external Redis see the same data.
const admin = new Redis({ host, port, db });
await admin.flushdb();
admin.disconnect();

// What a producer app would have created.
for (const s of [
  { name: 'emails', prefix: 'bull', jobs: 4 },
  { name: 'billing', prefix: 'bull', jobs: 1 },
  { name: 'v1.bulkSync', prefix: 'bull:260', jobs: 2 },
]) {
  const q = new Queue(s.name, { connection: { host, port, db }, prefix: s.prefix });
  for (let i = 0; i < s.jobs; i++) await q.add('job', { i });
  await q.close();
}

const configDir = mkdtempSync(path.join(tmpdir(), 'qd-e2e-'));
writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ version: 1, connections: [] }));

const server = spawn(process.execPath, ['dist/index.js'], {
  cwd: path.join(ROOT, 'server'),
  env: {
    ...process.env,
    PORT: String(PORT),
    CONFIG_PATH: path.join(configDir, 'config.json'),
    WEB_DIST: path.join(ROOT, 'web', 'dist'),
    ADMIN_USERNAME: 'e2e-admin',
    ADMIN_PASSWORD: 'e2e-admin-pw',
    READER_USERNAME: 'e2e-reader',
    READER_PASSWORD: 'e2e-reader-pw',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.kill();
  await container?.stop().catch(() => {});
  process.exit(code);
}
process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());
server.on('exit', (c) => {
  if (!shuttingDown) {
    console.error(`server exited unexpectedly (${c})`);
    shutdown(1);
  }
});

let out = '';
server.stdout.on('data', (d) => {
  process.stderr.write(d);
  out += d;
  if (out.includes('listening on')) {
    out = '';
    console.log(JSON.stringify({ ready: true, redisHost: host, redisPort: port, redisDb: db }));
  }
});
