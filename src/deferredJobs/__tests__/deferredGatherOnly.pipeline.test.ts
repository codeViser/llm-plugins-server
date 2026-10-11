import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JobStore } from '@/multiAgent/jobStore';

const gotPost = vi.hoisted(() => vi.fn());

vi.mock('got', () => ({
  default: {
    post: gotPost,
  },
}));

import { runDeferredJob } from '../deferredJobWorker';

const HAIKYU_PROFILE = {
  schema_version: 2 as const,
  model_id: 'anthropic/claude-haikyu-5.5',
  ref: 'anthropic/claude-haikyu-5.5',
  api_family: 'openrouter_chat_completions' as const,
  model_slug: 'anthropic/claude-haikyu-5.5',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  body_extensions: { stream: false, reasoning_effort: 'low' },
};

describe('deferred gather-only pipeline (integration)', () => {
  beforeEach(() => {
    gotPost.mockReset();
    gotPost.mockResolvedValue({
      body: {
        choices: [{ message: { role: 'assistant', content: 'Wi‑Fi peer research summary' } }],
      },
    });
  });

  it('skip_batch completes with tools packet and gather_only result', async () => {
    const jobs = new JobStore({ dbPath: ':memory:' });
    const job = jobs.create('AWDL verify', { job_kind: 'deferred_batch' });

    await runDeferredJob(
      job.id,
      {
        goal: 'AWDL verify',
        skip_batch: true,
        openrouter_api_key: 'or-test-key',
        gather_profile: HAIKYU_PROFILE,
        max_gather_turns: 2,
        max_tool_calls: 2,
      },
      jobs
    );

    const done = jobs.get(job.id);
    expect(done?.status).toBe('done');
    const result = done?.result as {
      gather_only?: boolean;
      final_answer?: string;
      evidence_packet?: { goal: string };
    };
    expect(result.gather_only).toBe(true);
    expect(result.final_answer).toContain('Wi‑Fi');
    expect(result.evidence_packet?.goal).toBe('AWDL verify');
    expect(gotPost).toHaveBeenCalled();
    const options = gotPost.mock.calls[0][1] as { json: Record<string, unknown> };
    expect(options.json.model).toBe('anthropic/claude-haiku-5.5');
  });

  it('surfaces OpenRouter model errors with provider message', async () => {
    gotPost.mockRejectedValue({
      message: 'Response code 400 (Bad Request)',
      response: {
        statusCode: 400,
        body: { error: { message: 'No endpoints found for fake/model' } },
      },
    });

    const jobs = new JobStore({ dbPath: ':memory:' });
    const job = jobs.create('bad model', { job_kind: 'deferred_batch' });

    await runDeferredJob(
      job.id,
      {
        goal: 'bad model',
        skip_batch: true,
        openrouter_api_key: 'or-test-key',
        gather_profile: {
          ...HAIKYU_PROFILE,
          model_slug: 'fake/model',
          model_id: 'fake/model',
          ref: 'fake/model',
        },
      },
      jobs
    );

    const failed = jobs.get(job.id);
    expect(failed?.status).toBe('error');
    expect(failed?.error).toContain('No endpoints found');
  });
});
