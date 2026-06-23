/**
 * Seed a local Redis with a few BullMQ queues + jobs for testing.
 * Usage: npm run seed   (optionally REDIS_HOST / REDIS_PORT)
 */
import { Queue } from 'bullmq';

const connection = {
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const QUEUES = ['email.welcome', 'email.reset', 'billing.invoice', 'reports'];

async function main() {
  for (const name of QUEUES) {
    const q = new Queue(name, { connection });
    for (let i = 0; i < 5; i++) {
      await q.add(`job-${i}`, { idx: i, at: name });
    }
    // leave a delayed job around so the board has something in each state
    await q.add('later', { delayed: true }, { delay: 60_000 });
    await q.close();
    console.log(`seeded ${name}`);
  }
  console.log('done');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
