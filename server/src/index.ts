import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { api } from './api.js';
import { getBoardRouter } from './bullboard.js';
import { loadConfig } from './config.js';
import { sseHandler } from './events.js';
import { initFromConfig } from './queueManager.js';

const PORT = Number(process.env.PORT ?? 3010);
const WEB_DIST = process.env.WEB_DIST ?? path.resolve(process.cwd(), '..', 'web', 'dist');

async function main() {
  const config = await loadConfig();

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Server-Sent Events (must be before the JSON-bodied API router is fine; no body here).
  app.get('/api/events', sseHandler);
  app.use('/api', api);

  // Dispatch to the per-connection bull-board instance.
  app.use('/board/:connId', (req, res, next) => {
    const router = getBoardRouter(req.params.connId);
    if (!router) return next();
    return router(req, res, next);
  });

  // Serve the built React app (production). In dev, Vite serves the UI and proxies here.
  if (existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get('*', (req, res, next) => {
      // Reserve /api and the per-connection board mounts (/board/<id>/...) for the
      // backend; the bare /board path is a client-side route served by the SPA.
      if (req.path.startsWith('/api') || req.path.startsWith('/board/')) return next();
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

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
