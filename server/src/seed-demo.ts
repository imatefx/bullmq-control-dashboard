/**
 * Seed a dedicated demo Redis DB with nicely-named BullMQ queues and a realistic
 * mix of job states (completed / failed / waiting / delayed) for screenshots.
 * Usage: npm run seed:demo   (DEMO_DB defaults to 5)
 */
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

const db = Number(process.env.DEMO_DB ?? 5);
const connection = { host: process.env.REDIS_HOST ?? '127.0.0.1', port: Number(process.env.REDIS_PORT ?? 6379), db };

type Spec = {
  name: string;
  waiting: number;
  delayed?: number;
  process?: { ok: number; fail: number };
};

const SPECS: Spec[] = [
  { name: 'notifications.email', waiting: 8, delayed: 2, process: { ok: 142, fail: 3 } },
  { name: 'notifications.sms', waiting: 5, process: { ok: 88, fail: 7 } },
  { name: 'notifications.push', waiting: 12, delayed: 1 },
  { name: 'payments.charge', waiting: 3, process: { ok: 210, fail: 0 } },
  { name: 'payments.refund', waiting: 2, process: { ok: 34, fail: 1 } },
  { name: 'media.transcode', waiting: 6, delayed: 4 },
  { name: 'media.thumbnail', waiting: 9, process: { ok: 55, fail: 2 } },
  { name: 'reports.daily', waiting: 1, process: { ok: 30, fail: 0 } },
  { name: 'search.reindex', waiting: 4, delayed: 1 },
];

async function seedQueue(spec: Spec) {
  const queue = new Queue(spec.name, { connection });

  if (spec.process) {
    const total = spec.process.ok + spec.process.fail;
    for (let i = 0; i < spec.process.fail; i++)
      await queue.add('task', { willFail: true }, { attempts: 1 });
    for (let i = 0; i < spec.process.ok; i++)
      await queue.add('task', { willFail: false }, { attempts: 1 });

    await new Promise<void>((resolve) => {
      let done = 0;
      const worker = new Worker(
        spec.name,
        async (job) => {
          if (job.data.willFail) throw new Error('simulated failure');
          return 'ok';
        },
        { connection, concurrency: 10 },
      );
      const check = () => {
        if (++done >= total) worker.close().then(resolve);
      };
      worker.on('completed', check);
      worker.on('failed', check);
    });
  }

  for (let i = 0; i < spec.waiting; i++) await queue.add('task', { i });
  for (let i = 0; i < (spec.delayed ?? 0); i++) await queue.add('task', { i }, { delay: 3_600_000 });

  await queue.close();
  console.log(`seeded ${spec.name}`);
}

async function main() {
  // Isolate the demo data: wipe only the demo DB.
  const flusher = new Redis({ ...connection, maxRetriesPerRequest: null });
  await flusher.flushdb();
  flusher.disconnect();

  for (const spec of SPECS) await seedQueue(spec);
  console.log(`done (db ${db})`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
