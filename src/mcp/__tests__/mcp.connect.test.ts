import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '@/common/utils/envConfig';
import { app } from '@/server';

const token = env.MCP_AUTH_TOKEN || 'dummy-token';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', ...headers },
  });
}

describe('POST /mcp-connect', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a missing bearer with JSON, not the Swagger page', async () => {
    const response = await request(app).post('/mcp-connect').send({ url: 'http://127.0.0.1:8790/shadow/healthz' });

    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.text.startsWith('<')).toBe(false);
    expect(response.text.includes('<!-- HTML')).toBe(false);
    expect(response.body.error).toBe('Authorization header is required');
  });

  it('proxies an authorized fetch and does not forward hop-by-hop headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true, service: 'hub' }));

    const response = await request(app)
      .post('//mcp-connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        url: 'http://127.0.0.1:8790/shadow/healthz',
        options: { method: 'GET', headers: { Accept: 'application/json' } },
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.headers['access-control-expose-headers']).toBe('*');
    expect(response.body).toEqual({ ok: true, service: 'hub' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8790/shadow/healthz',
      expect.objectContaining({ method: 'GET', headers: { Accept: 'application/json' } })
    );
  });

  it('returns JSON 400 when the target URL is missing or not http(s)', async () => {
    const missing = await request(app).post('/mcp-connect').set('Authorization', `Bearer ${token}`).send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe('URL is required');

    const blocked = await request(app)
      .post('/mcp-connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'file:///etc/passwd' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe('URL must be http or https');
  });
});
