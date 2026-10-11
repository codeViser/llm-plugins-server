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
