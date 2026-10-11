import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { computeCatalogHash } from '@/executionSurface/catalogHash';

import { app } from '@/server';

import { OR_GATHER_PROFILE } from './fixtures';

describe('deferred handoff dry_run', () => {

  it('relay_mode none maps tavily to pi_connector_http without relay_required', async () => {
    const tools = [
      {
        handle: 'plugin:tavily_search',
        function: {
          name: 'tavily_search',
          description: 'search',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      },
    ];
    const res = await request(app)
      .post('/deferred-jobs/run')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(
        JSON.stringify({
          goal: 'handoff probe',
          dry_run: true,
          mcp_auth_token: 'dummy-token',
          relay_mode: 'none',
          gather_profile: OR_GATHER_PROFILE,
          tool_catalog_v1: {
            schema_version: 1,
            catalog_hash: computeCatalogHash(tools),
            tools,
          },
        })
      );
    expect(res.status).toBe(200);
    expect(res.body.relay_mode).toBe('none');
    expect(res.body.relay_required).toBe(false);
    expect(res.body.tool_catalog_resolved.pi_connector_http).toBe(1);
    expect(res.body.degraded_tools).toEqual([]);
  });
});
