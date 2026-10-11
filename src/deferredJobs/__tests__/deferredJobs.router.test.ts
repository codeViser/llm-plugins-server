import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app } from '@/server';

import { OR_GATHER_PROFILE } from './fixtures';

describe('deferred-jobs router', () => {
  it('dry_run returns profiles and parity', async () => {
    const res = await request(app)
      .post('/deferred-jobs/run')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(
        JSON.stringify({
          goal: 'dry',
          dry_run: true,
          mcp_auth_token: 'dummy-token',
          gather_profile: OR_GATHER_PROFILE,
        })
      );
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.gather_profile.model_id).toBe('openai/gpt-6-luna');
    expect(res.body.tools_parity.explain).toMatch(/pi_tool_count=\d+/);
  });

  it('dry_run canonicalizes haikyu gather slug in response profile', async () => {
    const res = await request(app)
      .post('/deferred-jobs/run')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(
        JSON.stringify({
          goal: 'canonicalize',
          dry_run: true,
          mcp_auth_token: 'dummy-token',
          gather_profile: {
            schema_version: 2,
            model_id: 'anthropic/claude-haikyu-5.5',
            api_family: 'openrouter_chat_completions',
            model_slug: 'anthropic/claude-haikyu-5.5',
          },
        })
      );
    expect(res.status).toBe(200);
    expect(res.body.gather_profile.model_slug).toBe('anthropic/claude-haiku-5.5');
  });

  it('dry_run returns tool_catalog_resolved when catalog sent', async () => {
    const tools = [
      {
        handle: 'plugin:tavily_search',
        function: {
          name: 'tavily_search',
          description: 'search',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
    const { computeCatalogHash } = await import('@/executionSurface/catalogHash');
    const res = await request(app)
      .post('/deferred-jobs/run')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(
        JSON.stringify({
          goal: 'dry',
          dry_run: true,
          mcp_auth_token: 'dummy-token',
          gather_profile: OR_GATHER_PROFILE,
          relay_mode: 'optional',
          tool_catalog_v1: {
            schema_version: 1,
            catalog_hash: computeCatalogHash(tools),
            tools,
          },
        })
      );
    expect(res.status).toBe(200);
    expect(res.body.tool_catalog_resolved.relay_required).toBe(true);
    expect(res.body.tool_catalog_resolved.client).toBe(1);
  });

  it('dry_run accepts null chat_overlay and chat_wire (TM plugin JSON)', async () => {
    const res = await request(app)
      .post('/deferred-jobs/run')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(
        JSON.stringify({
          goal: 'null-overlay',
          dry_run: true,
          mcp_auth_token: 'dummy-token',
          gather_profile: { ...OR_GATHER_PROFILE, chat_overlay: null },
          tm_execution_context: {
            mcp_server_ids: [],
            enabled_plugin_ids: [],
            chat_wire: null,
          },
        })
      );
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
  });
});
