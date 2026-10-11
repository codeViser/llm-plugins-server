import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JobStore } from '@/multiAgent/jobStore';

const gotPost = vi.hoisted(() => vi.fn());

vi.mock('got', () => ({
  default: {
    post: gotPost,
    get: vi.fn(),
  },
}));

import * as openRouterBatch from '../openRouterBatch';
import { runDeferredJob } from '../deferredJobWorker';

describe('deferred refine orchestration', () => {
  beforeEach(() => {
    gotPost.mockReset();
    vi.restoreAllMocks();
    let gatherCalls = 0;
    gotPost.mockImplementation((_url: string, opts: { json: Record<string, unknown> }) => {
      const model = opts.json.model as string;
      if (model?.includes('haiku')) {
        gatherCalls += 1;
        return Promise.resolve({
          body: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: gatherCalls === 1 ? 'initial gather' : 'follow-up gather with tools',
                },
              },
            ],
          },
        });
      }
      if (model?.includes('sonnet')) {
        const isFirstThink = gatherCalls <= 1;
        return Promise.resolve({
          body: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: isFirstThink
                    ? '{"final_answer":"draft","evidence_requests":[{"query":"apple vision pro wifi aware doc"}]}'
                    : '{"final_answer":"Final after refine","evidence_requests":[]}',
                },
              },
            ],
          },
        });
      }
      return Promise.reject(new Error(`unexpected model ${model}`));
    });
    vi.spyOn(openRouterBatch, 'submitOpenRouterBatch').mockRejectedValue(
      new Error('OpenRouter batch submit (HTTP 404): unavailable')
    );
  });

  it('runs gather again when sync think returns evidence_requests', async () => {
    const jobs = new JobStore({ dbPath: ':memory:' });
    const job = jobs.create('refine path', { job_kind: 'deferred_batch' });

    await runDeferredJob(
      job.id,
      {
        goal: 'refine path',
        openrouter_api_key: 'or-key',
        max_refine_rounds: 1,
        gather_profile: {
          schema_version: 2,
          model_id: 'anthropic/claude-haiku-5.5',
          api_family: 'openrouter_chat_completions',
          model_slug: 'anthropic/claude-haiku-5.5',
        },
        think_profile: {
          schema_version: 2,
          model_id: 'anthropic/claude-sonnet-5.5:batch',
          api_family: 'openrouter_batch',
          model_slug: 'anthropic/claude-sonnet-5.5:batch',
        },
      },
      jobs
    );

    const done = jobs.get(job.id);
    expect(done?.status).toBe('done');
    const result = done?.result as { final_answer?: string; refine_rounds?: number };
    expect(result.final_answer).toContain('Final after refine');
    expect(result.refine_rounds).toBe(1);
    const haikuCalls = gotPost.mock.calls.filter(
      (c) => (c[1] as { json: { model?: string } }).json.model?.includes('haiku')
    );
    expect(haikuCalls.length).toBeGreaterThanOrEqual(2);
  });
});
