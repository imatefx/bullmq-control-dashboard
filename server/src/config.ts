import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ConfigSchema, type Config } from './types.js';

const CONFIG_PATH =
  process.env.CONFIG_PATH ?? path.resolve(process.cwd(), '..', 'config', 'config.json');

let cache: Config = { version: 1, connections: [] };

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    cache = ConfigSchema.parse(JSON.parse(raw));
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      cache = { version: 1, connections: [] };
      await saveConfig(cache);
    } else {
      throw err;
    }
  }
  return cache;
}

export function getConfig(): Config {
  return cache;
}

export async function saveConfig(next: Config): Promise<Config> {
  cache = ConfigSchema.parse(next);
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cache, null, 2), 'utf8');
  return cache;
}

/** Mutate the in-memory config and persist it. */
export async function updateConfig(fn: (cfg: Config) => void): Promise<Config> {
  const draft: Config = JSON.parse(JSON.stringify(cache));
  fn(draft);
  return saveConfig(draft);
}

/** Resolve ${ENV_VAR} templates in a secret value at use time. */
export function resolveSecret(value?: string): string | undefined {
  if (!value) return undefined;
  return value.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');
}

/** Produce an exportable copy. Secrets are redacted unless includeSecrets. */
export function exportConfig(includeSecrets: boolean): Config {
  const copy: Config = JSON.parse(JSON.stringify(cache));
  if (!includeSecrets) {
    for (const conn of copy.connections) {
      if (conn.redis.password) conn.redis.password = '';
    }
  }
  return copy;
}
