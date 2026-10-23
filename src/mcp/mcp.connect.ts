import { Readable } from 'node:stream';

import type { Request, Response as ExpressResponse } from 'express';
import { pino } from 'pino';

const logger = pino({ name: 'mcp-connect' });

const HOP_BY_HOP = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

export type FetchLike = (url: string, init?: RequestInit) => Promise<globalThis.Response>;

/**
 * Keep only the fetch fields TypingMind serializes into `{ url, options }`.
 * Extra browser-only fields (`mode`, `credentials`, `signal`) are dropped so
 * Node's fetch does not reject the proxied request.
 */
export function toProxyInit(options: unknown): RequestInit {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return {};
  const source = options as Record<string, unknown>;
  const init: RequestInit = {};
  if (typeof source.method === 'string' && source.method.trim()) {
    init.method = source.method;
  }
  if (source.headers && typeof source.headers === 'object' && !Array.isArray(source.headers)) {
    init.headers = source.headers as HeadersInit;
  }
  if (typeof source.body === 'string') {
    init.body = source.body;
  } else if (source.body != null && typeof source.body === 'object') {
    init.body = JSON.stringify(source.body);
  }
  if (source.redirect === 'follow' || source.redirect === 'manual' || source.redirect === 'error') {
    init.redirect = source.redirect;
  }
  return init;
}

export function assertHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('URL is invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL must be http or https');
  }
  return parsed;
}

/**
 * Proxy one fetch for the TypingMind private connector.
 *
 * Remote HTTP MCP servers are reached as `POST /mcp-connect` with
 * `{ url, options }`. The upstream status, headers, and body are streamed
 * back unchanged. A missing route falls through to Swagger HTML, and the
 * client then fails `response.json()` with `Unexpected token '<'`.
 */
export async function proxyMcpConnect(
  req: Request,
  res: ExpressResponse,
  fetchImpl: FetchLike = fetch
): Promise<void> {
  try {
    const body = (req.body ?? {}) as { url?: unknown; options?: unknown };
    const url = typeof body.url === 'string' ? body.url : '';
    if (!url) {
      res.status(400).json({ error: 'URL is required' });
      return;
    }
    try {
      assertHttpUrl(url);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'URL is invalid';
      res.status(400).json({ error: message });
      return;
    }

    const upstream = await fetchImpl(url, toProxyInit(body.options));
    const headers: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower) || lower.startsWith('access-control-')) return;
      headers[key] = value;
    });

    res.status(upstream.status);
    res.setHeader('Access-Control-Expose-Headers', '*');
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }

    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: message }, 'Error in mcp-connect');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', details: message });
    }
  }
}
