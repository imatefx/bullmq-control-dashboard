import express, { type Express } from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { api } from './api.js';
import { authenticate, enforceReadOnlyForReader } from './auth.js';
import { getBoardRouter } from './bullboard.js';
import { sseHandler } from './events.js';

/** Build the Express app (auth, API, boards, static UI). Has no side effects beyond routing. */
export function createApp(opts: { webDist?: string } = {}): Express {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // HTTP Basic Auth gates everything below (API, board iframe, static UI).
  app.use(authenticate);
  app.get('/api/me', (req, res) => res.json({ role: req.role, username: req.username }));

  // Readers may only GET — blocks both /api mutations and /board job actions.
  app.use(enforceReadOnlyForReader);

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
  const webDist = opts.webDist;
  if (webDist && existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (req, res, next) => {
      // Reserve /api and the per-connection board mounts (/board/<id>/...) for the
      // backend; the bare /board path is a client-side route served by the SPA.
      if (req.path.startsWith('/api') || req.path.startsWith('/board/')) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  return app;
}
