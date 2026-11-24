import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// src/config.ts resolves CONFIG_PATH when first imported, so set it before any test imports it.
process.env.CONFIG_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'qd-test-')), 'config.json');
