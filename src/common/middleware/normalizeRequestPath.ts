import { NextFunction, Request, Response } from 'express';

/**
 * Collapse duplicate slashes in the request path.
 *
 * Some MCP clients concatenate `baseUrl + '/start'` even when `baseUrl` already
 * ends with `/`, producing `//start`. Desktop Chromium often normalizes that
 * before the request; iOS WebKit does not. Un-normalized `//start` misses the
 * API route and falls through to Swagger HTML, which then fails JSON parsing.
 *
 * Query strings are preserved. `req.url` is path+query only (not the origin).
 */
export function normalizeRequestPath(req: Request, _res: Response, next: NextFunction): void {
  const raw = req.url || '/';
  const q = raw.indexOf('?');
  const path = q === -1 ? raw : raw.slice(0, q);
  const query = q === -1 ? '' : raw.slice(q);
  const normalized = path.replace(/\/{2,}/g, '/') || '/';
  if (normalized !== path) {
    req.url = normalized + query;
  }
  next();
}
