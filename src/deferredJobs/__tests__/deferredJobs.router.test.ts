import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { app } from '@/server';

import * as gatherAgent from '../gatherAgent';

describe('deferred-jobs router', () => {
  it('dry_run returns config without starting job', async () => {
    const res = await request(app)
      .post('/deferred-jobs/run')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(
        JSON.stringify({
          goal: 'dry',
          dry_run: true,
          mcp_auth_token: 'dummy-token',
        })
      );
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.goal).toBe('dry');
  });

  it('accepts async gather-only job', async () => {
    vi.spyOn(gatherAgent, 'runGatherAgent').mockResolvedValue({
      packet: {
        schema_version: 1,
        goal: 'async',
        sources: [],
        tool_trace: [],
        gather_model: 'openai/gpt-4o-mini',
        packet_hash: 'h',
      },
      toolsInvoked: [],
      finalAssistantText: 'ok',
    });

    const res = await request(app)
      .post('/deferred-jobs/run')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(
        JSON.stringify({
          goal: 'async gather test',
          mcp_auth_token: 'dummy-token',
          gather_model: 'openai/gpt-4o-mini',
          openai_api_key: 'sk-test',
          skip_batch: true,
        })
      );
    expect(res.status).toBe(202);
    expect(res.body.job_id).toBeTruthy();
    expect(res.body.kind).toBe('deferred_batch');
  });
});
