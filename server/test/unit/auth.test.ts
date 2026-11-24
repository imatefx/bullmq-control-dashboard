import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertAuthConfigured, authenticate, enforceReadOnlyForReader } from '../../src/auth.js';
import { basicAuth } from '../support/fixtures.js';

function mockRes() {
  const res: any = {};
  res.setHeader = vi.fn(() => res);
  res.status = vi.fn(() => res);
  res.send = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as Response & Record<string, ReturnType<typeof vi.fn>>;
}

function run(header?: string, method = 'GET') {
  const req = { headers: header ? { authorization: header } : {}, method } as Request;
  const res = mockRes();
  const next = vi.fn() as unknown as NextFunction;
  authenticate(req, res, next);
  return { req, res, next };
}

beforeEach(() => {
  vi.stubEnv('ADMIN_USERNAME', 'admin');
  vi.stubEnv('ADMIN_PASSWORD', 'adminpw');
  vi.stubEnv('READER_USERNAME', 'reader');
  vi.stubEnv('READER_PASSWORD', 'readerpw');
});

describe('assertAuthConfigured', () => {
  it('passes when admin credentials are set', () => {
    expect(() => assertAuthConfigured()).not.toThrow();
  });

  it.each(['ADMIN_USERNAME', 'ADMIN_PASSWORD'])('fails closed when %s is missing', (name) => {
    vi.stubEnv(name, '');
    expect(() => assertAuthConfigured()).toThrow(/Auth not configured/);
  });
});

describe('authenticate', () => {
  it('accepts the admin and tags the request', () => {
    const { req, next, res } = run(basicAuth('admin', 'adminpw'));
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.role).toBe('admin');
    expect(req.username).toBe('admin');
  });

  it('accepts the reader with the reader role', () => {
    const { req, next } = run(basicAuth('reader', 'readerpw'));
    expect(next).toHaveBeenCalledOnce();
    expect(req.role).toBe('reader');
  });

  it('allows passwords containing ":"', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'a:b:c');
    const { next } = run(basicAuth('admin', 'a:b:c'));
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([
    ['no header', undefined],
    ['non-basic scheme', 'Bearer abc'],
    ['no colon', `Basic ${Buffer.from('adminadminpw').toString('base64')}`],
    ['wrong password', basicAuth('admin', 'nope')],
    ['wrong password, same length', basicAuth('admin', 'adminpX')],
    ['unknown user', basicAuth('mallory', 'adminpw')],
    ['reader password for admin', basicAuth('admin', 'readerpw')],
  ])('rejects %s with 401 + challenge', (_label, header) => {
    const { res, next } = run(header);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', expect.stringMatching(/^Basic realm=/));
  });

  it('ignores reader credentials when the reader password is unset', () => {
    vi.stubEnv('READER_PASSWORD', '');
    const { next } = run(basicAuth('reader', ''));
    expect(next).not.toHaveBeenCalled();
  });
});

describe('enforceReadOnlyForReader', () => {
  function check(role: 'admin' | 'reader', method: string) {
    const req = { role, method } as Request;
    const res = mockRes();
    const next = vi.fn();
    enforceReadOnlyForReader(req, res, next as unknown as NextFunction);
    return { res, next };
  }

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets readers %s', (method) => {
    expect(check('reader', method).next).toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('blocks readers from %s with 403', (method) => {
    const { res, next } = check('reader', method);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('lets admins write', () => {
    expect(check('admin', 'DELETE').next).toHaveBeenCalled();
  });
});
