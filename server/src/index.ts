import dotenv from 'dotenv';
import path from 'node:path';
import { createApp } from './app.js';
import { assertAuthConfigured } from './auth.js';
import { loadConfig } from './config.js';
import { initFromConfig } from './queueManager.js';

const PORT = Number(process.env.PORT ?? 3010);
const WEB_DIST = process.env.WEB_DIST ?? path.resolve(process.cwd(), '..', 'web', 'dist');

async function main() {
  // Load .env from the repo root (cwd is the server workspace). Real env vars win.
  dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
  assertAuthConfigured(); // fail closed if admin credentials are missing
  const config = await loadConfig();

  const app = createApp({ webDist: WEB_DIST });

  await initFromConfig(config);

  app.listen(PORT, () => {
    console.log(`[queue-dashboard] listening on http://localhost:${PORT}`);
    console.log(`[queue-dashboard] ${config.connections.length} connection(s) loaded`);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
