import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JobStore } from '@/multiAgent/jobStore';

const gotPost = vi.hoisted(() => vi.fn());

vi.mock('got', () => ({
  default: {
    post: gotPost,
  },
}));

import { runDeferredJob } from '../deferredJobWorker';

const GATHER_HAIKYU = {
  schema_version: 2 as const,
  model_id: 'anthropic/claude-haikyu-5.5',
  api_family: 'openrouter_chat_completions' as const,
  model_slug: 'anthropic/claude-haikyu-5.5',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  body_extensions: { stream: false, reasoning_effort: 'low' },
};

const THINK_SONNET = {
  schema_version: 2 as const,
  model_id: 'anthropic/claude-sonnet-5.5',
  api_family: 'openrouter_chat_completions' as const,
  model_slug: 'anthropic/claude-sonnet-5.5',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  body_extensions: { stream: false, reasoning_effort: 'medium' },
};

describe('deferred full pipeline (gather + sync OR think)', () => {
  beforeEach(() => {
    gotPost.mockReset();
    gotPost.mockImplementation((_url: string, opts: { json: Record<string, unknown> }) => {
      const model = opts.json.model;
      if (model === 'anthropic/claude-haiku-5.5') {
        return Promise.resolve({
          body: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Evidence: Apple docs say peer AWDL is restricted on some networks.',
                },
              },
            ],
          },
        });
      }
      if (model === 'anthropic/claude-sonnet-5.5') {
        return Promise.resolve({
          body: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '{"final_answer":"Synthesis with citations.","evidence_requests":[]}',
                },
              },
            ],
          },
        });
      }
      return Promise.reject(new Error(`unexpected model ${model}`));
    });
  });

  it('runs gather then sync think tier', async () => {
    const jobs = new JobStore({ dbPath: ':memory:' });
    const job = jobs.create('Apple AWDL research', { job_kind: 'deferred_batch' });

    await runDeferredJob(
      job.id,
      {
        goal: 'Apple AWDL research',
        openrouter_api_key: 'or-key',
        gather_profile: GATHER_HAIKYU,
        think_profile: THINK_SONNET,
        skip_batch: undefined,
      },
      jobs
    );

    const done = jobs.get(job.id);
    expect(done?.status).toBe('done');
    const result = done?.result as { final_answer?: string; think_sync?: boolean };
    expect(result.think_sync).toBe(true);
    expect(result.final_answer).toContain('Synthesis');
    expect(gotPost).toHaveBeenCalledTimes(2);
    const gatherPayload = (gotPost.mock.calls[0][1] as { json: Record<string, unknown> }).json;
    expect(gatherPayload.reasoning_effort).toBeUndefined();
    const thinkPayload = (gotPost.mock.calls[1][1] as { json: Record<string, unknown> }).json;
    expect(thinkPayload.reasoning_effort).toBe('medium');
  });
});
