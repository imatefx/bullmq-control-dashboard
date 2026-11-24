import { readFile, writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportConfig,
  getConfig,
  loadConfig,
  resolveSecret,
  saveConfig,
  updateConfig,
} from '../../src/config.js';
import { connection } from '../support/fixtures.js';

const CONFIG_PATH = process.env.CONFIG_PATH!;

describe('resolveSecret', () => {
  it('returns undefined for empty values', () => {
    expect(resolveSecret(undefined)).toBeUndefined();
    expect(resolveSecret('')).toBeUndefined();
  });

  it('passes literal values through', () => {
    expect(resolveSecret('hunter2')).toBe('hunter2');
  });

  it('expands ${ENV} templates, missing vars become empty', () => {
    vi.stubEnv('QD_SECRET', 's3cret');
    expect(resolveSecret('${QD_SECRET}')).toBe('s3cret');
    expect(resolveSecret('pre-${QD_SECRET}-${QD_MISSING}')).toBe('pre-s3cret-');
  });
});

describe('config persistence', () => {
  beforeEach(async () => {
    await saveConfig({ version: 1, connections: [] });
  });

  it('creates an empty config file when none exists', async () => {
    const { rm } = await import('node:fs/promises');
    await rm(CONFIG_PATH);
    const cfg = await loadConfig();
    expect(cfg).toEqual({ version: 1, connections: [] });
    expect(JSON.parse(await readFile(CONFIG_PATH, 'utf8'))).toEqual(cfg);
  });

  it('applies schema defaults when loading', async () => {
    await writeFile(
      CONFIG_PATH,
      JSON.stringify({ connections: [{ id: 'a', name: 'A', redis: { host: 'h' } }] }),
    );
    const cfg = await loadConfig();
    expect(cfg.connections[0]).toMatchObject({
      autoRefresh: true,
      refreshIntervalMs: 15000,
      queues: [],
      redis: { host: 'h', port: 6379, db: 0, tls: false, cluster: false, prefix: 'bull' },
    });
  });

  it('rejects malformed JSON instead of silently resetting', async () => {
    await writeFile(CONFIG_PATH, '{not json');
    await expect(loadConfig()).rejects.toThrow();
  });

  it('rejects configs that fail validation', async () => {
    await writeFile(CONFIG_PATH, JSON.stringify({ connections: [{ id: 'a', name: '', redis: {} }] }));
    await expect(loadConfig()).rejects.toThrow();
  });

  it('updateConfig persists changes and does not mutate the previous snapshot', async () => {
    const before = getConfig();
    await updateConfig((cfg) => {
      cfg.connections.push(connection({ id: 'x' }));
    });
    expect(before.connections).toHaveLength(0);
    expect(getConfig().connections.map((c) => c.id)).toEqual(['x']);
    const onDisk = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    expect(onDisk.connections[0].id).toBe('x');
  });

  it('exportConfig redacts passwords unless asked for secrets', async () => {
    await saveConfig({
      version: 1,
      connections: [connection({ redis: { password: 'pw' } })],
    });
    expect(exportConfig(false).connections[0].redis.password).toBe('');
    expect(exportConfig(true).connections[0].redis.password).toBe('pw');
    // Redaction works on a copy.
    expect(getConfig().connections[0].redis.password).toBe('pw');
  });
});
