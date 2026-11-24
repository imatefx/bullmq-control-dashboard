import { ConnectionSchema, RedisConfigSchema, type Connection, type RedisConfig } from '../../src/types.js';

export function redisConfig(over: Partial<RedisConfig> = {}): RedisConfig {
  return RedisConfigSchema.parse({ host: '127.0.0.1', port: 6379, ...over });
}

export function connection(
  over: Partial<Omit<Connection, 'redis'>> & { redis?: Partial<RedisConfig> } = {},
): Connection {
  const { redis, ...rest } = over;
  return ConnectionSchema.parse({
    id: 'conn_test',
    name: 'Test',
    autoRefresh: false,
    ...rest,
    redis: redisConfig(redis),
  });
}

export function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}
