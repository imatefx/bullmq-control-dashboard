import type { Request, Response } from 'express';

const clients = new Set<Response>();

export function sseHandler(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`event: hello\ndata: {}\n\n`);

  clients.add(res);
  const ping = setInterval(() => res.write(`event: ping\ndata: {}\n\n`), 25000);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export type AppEvent =
  | { type: 'connection:status'; connId: string; status: ConnStatus }
  | { type: 'queues:changed'; connId: string }
  | { type: 'config:changed' };

export type ConnStatus = {
  state: 'ok' | 'error' | 'connecting';
  error?: string;
  discovered?: number;
  registered?: number;
  lastSync?: number;
};

export function broadcast(event: AppEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(payload);
}
