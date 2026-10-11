import { describe, expect, it } from 'vitest';

import { JobStore } from '@/multiAgent/jobStore';

describe('deferred job secrets hygiene', () => {
  it('input_json never stores API keys from run payload', () => {
    const jobs = new JobStore();
    const job = jobs.create('secret hygiene', {
      job_kind: 'deferred_batch',
      gather_model: 'gpt-6-luna',
      tm_execution_context: { mcp_server_ids: [], enabled_plugin_ids: [] },
    });
    const raw = JSON.stringify(jobs.get(job.id)?.input ?? {});
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(raw).not.toContain('openai_api_key');
    expect(raw).not.toContain('openrouter_api_key');
    expect(raw).not.toContain('mcp_auth_token');
  });
});
