import { z } from 'zod';

export const RedisConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().default(6379),
  password: z.string().optional(),
  db: z.number().int().default(0),
  tls: z.boolean().default(false),
  // BullMQ key prefix used when scanning/instantiating queues (default 'bull')
  prefix: z.string().default('bull'),
});

export const QueueOverrideSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().default(''),
  delimiter: z.string().default(''),
  readOnlyMode: z.boolean().default(false),
  enabled: z.boolean().default(false),
  description: z.string().default(''),
});

export const ConnectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  redis: RedisConfigSchema,
  autoRefresh: z.boolean().default(true),
  refreshIntervalMs: z.number().int().min(2000).default(15000),
  queues: z.array(QueueOverrideSchema).default([]),
});

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  connections: z.array(ConnectionSchema).default([]),
});

export type RedisConfig = z.infer<typeof RedisConfigSchema>;
export type QueueOverride = z.infer<typeof QueueOverrideSchema>;
export type Connection = z.infer<typeof ConnectionSchema>;
export type Config = z.infer<typeof ConfigSchema>;
