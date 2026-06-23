import { createBullBoard } from '@bull-board/api';
import type { BaseAdapter } from '@bull-board/api/baseAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { RequestHandler } from 'express';

export const COMBINED_ID = 'all';

type Board = {
  serverAdapter: ExpressAdapter;
  addQueue: (q: BaseAdapter) => void;
  removeQueue: (q: BaseAdapter | string) => void;
};

const boards = new Map<string, Board>();

export function ensureBoard(connId: string): Board {
  let board = boards.get(connId);
  if (board) return board;

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(`/board/${connId}`);
  const { addQueue, removeQueue } = createBullBoard({
    queues: [],
    serverAdapter,
    options: { uiConfig: { sortQueues: true } },
  });
  board = { serverAdapter, addQueue, removeQueue };
  boards.set(connId, board);
  return board;
}

export function getBoardRouter(connId: string): RequestHandler | undefined {
  return boards.get(connId)?.serverAdapter.getRouter() as RequestHandler | undefined;
}

export function destroyBoard(connId: string): void {
  boards.delete(connId);
}

/** Combined board aggregating every server's queues (best-effort, deduped by name). */
export function combinedBoard(): Board {
  return ensureBoard(COMBINED_ID);
}
