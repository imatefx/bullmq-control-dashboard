# BullMQ Control Dashboard

A central **BullMQ queue management** system built on top of
[bull-board](https://github.com/felixmosh/bull-board), with a responsive React + shadcn UI in
front of it.

## Screenshots

**Overview** — aggregate job counts across every live queue:

![Overview](docs/screenshots/overview.png)

**Queues** — auto-discovered queues with grouping, rename, and read-only controls:

![Queues](docs/screenshots/queues.png)

**Board** — the embedded bull-board for the active server (or all servers combined):

![Board](docs/screenshots/board.png)

> Screenshots use a demo dataset (`npm run seed:demo`).

- **Add Redis connections** from the UI (multiple servers at once).
- **Auto-discover** all BullMQ queues in each Redis (`SCAN <prefix>:*:meta`).
- **Group, rename, and toggle read-only** per queue (bull-board `delimiter` / `displayName` /
  `readOnlyMode`).
- **Switch between servers** — each connection gets its own embedded bull-board at
  `/board/:connId`, plus a combined `/board/all`.
- **Auto-refresh** queues on an interval, or rescan on demand; queues are added/removed on the
  board live via bull-board's `addQueue` / `removeQueue`.
- **Export / import** the whole config as JSON (secrets redacted by default; passwords support
  `${ENV_VAR}` templates).
- **Overview** page aggregating job counts across all live queues.

## Architecture

Single combined Node service:

- **`server/`** — Express. Mounts a bull-board instance per connection at `/board/:connId`, a REST
  API at `/api/*`, an SSE stream at `/api/events`, and serves the built UI.
  - `discovery.ts` SCANs Redis for queue names; `queueManager.ts` instantiates a BullMQ `Queue` +
    `BullMQAdapter` per enabled queue and reconciles them into the right board on each sync.
  - `config.ts` persists everything to `config/config.json` (the source of truth).
- **`web/`** — Vite + React + TypeScript + Tailwind + shadcn/ui. Pages: Overview, Connections,
  Queues, Board, Config. A top-bar **server switcher** scopes the active server.

> bull-board renders live `Queue` objects — it has no Redis discovery, config, or auth of its own.
> This app supplies all three around it.

## Run

Requirements: Node 18+ and a reachable Redis.

```bash
npm install

# (optional) seed a local Redis with demo queues
npm run seed         # 4 simple queues in db 0
npm run seed:demo    # richer demo set (db 5) used for the screenshots above

# dev: API on :3010, Vite UI on :5173 (proxies /api and /board to the API)
npm run dev

# production: build the UI + server, then serve everything from :3010
npm run build
npm start            # http://localhost:3010
```

Config is stored at `config/config.json` (gitignored). Override the location with `CONFIG_PATH`,
the port with `PORT`.

## Notes

- **Auth**: none by default — run behind a trusted network / VPN, or add a middleware in
  `server/src/index.ts`.
- **Combined board** keys queues by name, so identical queue names across servers are deduped
  (first one wins). Per-server boards have no such limitation.
