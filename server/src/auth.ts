import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    role?: Role;
    username?: string;
  }
}

export type Role = 'admin' | 'reader';

type Credential = { username: string; password: string; role: Role };

function readCredentials(): Credential[] {
  const creds: Credential[] = [];
  const adminUser = process.env.ADMIN_USERNAME;
  const adminPass = process.env.ADMIN_PASSWORD;
  if (adminUser && adminPass) creds.push({ username: adminUser, password: adminPass, role: 'admin' });

  const readerUser = process.env.READER_USERNAME;
  const readerPass = process.env.READER_PASSWORD;
  if (readerUser && readerPass)
    creds.push({ username: readerUser, password: readerPass, role: 'reader' });

  return creds;
}

/** Fail closed: the server must not start without admin credentials. */
export function assertAuthConfigured(): void {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    throw new Error(
      'Auth not configured: set ADMIN_USERNAME and ADMIN_PASSWORD (and optionally ' +
        'READER_USERNAME / READER_PASSWORD) in the environment or a .env file.',
    );
  }
}

/** Constant-time string comparison that is safe for differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still run a comparison to keep timing uniform, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function unauthorized(res: Response): void {
  res.setHeader('WWW-Authenticate', 'Basic realm="BullMQ Control Dashboard", charset="UTF-8"');
  res.status(401).send('Authentication required');
}

/** HTTP Basic Auth: validates credentials and tags the request with a role. */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) return unauthorized(res);

  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return unauthorized(res);
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return unauthorized(res);
  const username = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);

  for (const cred of readCredentials()) {
    if (safeEqual(username, cred.username) && safeEqual(password, cred.password)) {
      req.role = cred.role;
      req.username = cred.username;
      return next();
    }
  }
  return unauthorized(res);
}

/** Readers may only perform safe (read) methods. Blocks both /api and /board writes. */
export function enforceReadOnlyForReader(req: Request, res: Response, next: NextFunction): void {
  if (req.role === 'reader' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.status(403).json({ error: 'read-only', message: 'Reader role cannot perform this action.' });
    return;
  }
  next();
}
