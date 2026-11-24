import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { inject } from 'vitest';

export function redisAddr() {
  return { host: inject('redisHost'), port: inject('redisPort'), db: inject('redisDb') };
}

export async function flushRedis(): Promise<void> {
  const r = new Redis(redisAddr());
  await r.flushdb(); // only the test database (see redis-container.ts)
  r.disconnect();
}

/** Create real BullMQ queues (as a producer app would) and add jobs to them. */
export async function seedQueues(
  specs: { name: string; prefix?: string; jobs?: number; failed?: number }[],
): Promise<void> {
  for (const s of specs) {
    const q = new Queue(s.name, { connection: redisAddr(), prefix: s.prefix ?? 'bull' });
    await q.waitUntilReady();
    for (let i = 0; i < (s.jobs ?? 0); i++) await q.add('job', { i });
    await q.close();
  }
}
