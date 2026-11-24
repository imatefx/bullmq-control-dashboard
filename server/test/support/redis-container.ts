import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    redisHost: string;
    redisPort: number;
    redisDb: number;
  }
}

let container: StartedRedisContainer | undefined;

export async function setup(project: TestProject) {
  // Opt-in only, via test-specific names: tests FLUSHDB this database, so a generic
  // REDIS_HOST exported for seeding a dev Redis must never be picked up here.
  if (process.env.TEST_REDIS_HOST) {
    project.provide('redisHost', process.env.TEST_REDIS_HOST);
    project.provide('redisPort', Number(process.env.TEST_REDIS_PORT ?? 6379));
    project.provide('redisDb', Number(process.env.TEST_REDIS_DB ?? 15));
    return;
  }
  container = await new RedisContainer('redis:7-alpine').start();
  project.provide('redisHost', container.getHost());
  project.provide('redisPort', container.getMappedPort(6379));
  project.provide('redisDb', 0);
}

export async function teardown() {
  await container?.stop();
}
