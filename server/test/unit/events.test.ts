import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { broadcast, sseHandler } from '../../src/events.js';

function connect() {
  const req = new EventEmitter() as unknown as Request;
  const res = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
  } as unknown as Response & { write: ReturnType<typeof vi.fn> };
  sseHandler(req, res);
  return { req, res };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('server-sent events', () => {
  it('sets SSE headers and greets the client', () => {
    const { req, res } = connect();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.write).toHaveBeenCalledWith('event: hello\ndata: {}\n\n');
    req.emit('close');
  });

  it('broadcasts to connected clients until they disconnect', () => {
    const a = connect();
    const b = connect();
    broadcast({ type: 'config:changed' });
    const payload = `data: ${JSON.stringify({ type: 'config:changed' })}\n\n`;
    expect(a.res.write).toHaveBeenLastCalledWith(payload);
    expect(b.res.write).toHaveBeenLastCalledWith(payload);

    a.req.emit('close');
    a.res.write.mockClear();
    b.res.write.mockClear();
    broadcast({ type: 'queues:changed', connId: 'x' });
    expect(a.res.write).not.toHaveBeenCalled();
    expect(b.res.write).toHaveBeenCalledTimes(1);
    b.req.emit('close');
  });

  it('keeps the stream alive with periodic pings, stopping on close', () => {
    vi.useFakeTimers();
    const { req, res } = connect();
    res.write.mockClear();
    vi.advanceTimersByTime(25_000);
    expect(res.write).toHaveBeenCalledWith('event: ping\ndata: {}\n\n');
    req.emit('close');
    res.write.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(res.write).not.toHaveBeenCalled();
  });
});
