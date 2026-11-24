import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { E2E_PORT } from '../playwright.config';

/**
 * Starts e2e/stack.mjs (Redis + seed data + production server) as a separate Node process —
 * BullMQ/Testcontainers don't load under Playwright's TS loader — and stops it afterwards.
 */
export default async function globalSetup() {
  const stack = spawn(process.execPath, [fileURLToPath(new URL('./stack.mjs', import.meta.url))], {
    env: { ...process.env, E2E_PORT: String(E2E_PORT) },
    stdio: ['ignore', 'pipe', process.env.E2E_DEBUG ? 'inherit' : 'ignore'],
  });

  type Info = { redisHost: string; redisPort: number; redisDb: number };
  const info = await new Promise<Info>((resolve, reject) => {
    const fail = (err: Error) => {
      clearTimeout(timer);
      stack.kill('SIGTERM'); // Playwright never gets our teardown if setup throws.
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error('e2e stack did not start within 120s')), 120_000);
    stack.once('exit', (code) =>
      fail(new Error(`e2e stack exited (${code}); rerun with E2E_DEBUG=1 for its output`)),
    );
    let buf = '';
    stack.stdout!.on('data', (d) => {
      buf += d;
      // Only parse complete lines; the ready line may arrive in several chunks.
      const lines = buf.split('\n');
      buf = lines.pop()!;
      const line = lines.find((l) => l.startsWith('{'));
      if (!line) return;
      clearTimeout(timer);
      stack.removeAllListeners('exit');
      try {
        resolve(JSON.parse(line));
      } catch (err) {
        fail(err as Error);
      }
    });
  });
  process.env.E2E_REDIS_HOST = info.redisHost;
  process.env.E2E_REDIS_PORT = String(info.redisPort);
  process.env.E2E_REDIS_DB = String(info.redisDb);

  return async () => {
    stack.kill('SIGTERM');
    await new Promise((r) => stack.once('exit', r));
  };
}
