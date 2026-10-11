import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JobStore } from '@/multiAgent/jobStore';

const gotPost = vi.hoisted(() => vi.fn());
const gotGet = vi.hoisted(() => vi.fn());

vi.mock('got', () => ({
  default: {
    post: gotPost,
    get: gotGet,
  },
}));

import * as openRouterBatch from '../openRouterBatch';
import { runDeferredJob } from '../deferredJobWorker';

const GATHER_PROFILE = {
  schema_version: 2 as const,
  model_id: 'anthropic/claude-haiku-5.5',
  api_family: 'openrouter_chat_completions' as const,
  model_slug: 'anthropic/claude-haiku-5.5',
  body_extensions: { stream: false },
};

const BATCH_THINK = {
  schema_version: 2 as const,
  model_id: 'anthropic/claude-sonnet-5.5:batch',
  api_family: 'openrouter_batch' as const,
  model_slug: 'anthropic/claude-sonnet-5.5:batch',
  body_extensions: { stream: false, reasoning_effort: 'medium' },
};

describe('deferred batch think fallback', () => {
  beforeEach(() => {
    gotPost.mockReset();
    gotGet.mockReset();
    let call = 0;
    gotPost.mockImplementation((_url: string, opts: { json: Record<string, unknown> }) => {
      call += 1;
      const model = opts.json.model as string;
      if (model?.includes('haiku')) {
        return Promise.resolve({
          body: {
            choices: [{ message: { role: 'assistant', content: 'gathered evidence text' } }],
          },
        });
      }
      if (_url.includes('/batches')) {
        return Promise.reject({
          message: 'Response code 404 (Not Found)',
          response: { statusCode: 404, body: { error: { message: 'Provider returned error' } } },
        });
      }
      if (model?.includes('sonnet')) {
        return Promise.resolve({
          body: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '{"final_answer":"Batch fallback synthesis","evidence_requests":[]}',
                },
              },
            ],
          },
        });
      }
      return Promise.reject(new Error(`unexpected call ${call} model=${model} url=${_url}`));
    });
  });

  it('falls back to sync OR think when batch submit returns 404', async () => {
    const jobs = new JobStore({ dbPath: ':memory:' });
    const job = jobs.create('batch fallback test', { job_kind: 'deferred_batch' });

    await runDeferredJob(
      job.id,
      {
        goal: 'batch fallback test',
        openrouter_api_key: 'or-key',
        gather_profile: GATHER_PROFILE,
        think_profile: BATCH_THINK,
      },
      jobs
    );

    const done = jobs.get(job.id);
    expect(done?.status).toBe('done');
    const result = done?.result as {
      final_answer?: string;
      think_sync?: boolean;
      think_batch_fallback?: boolean;
    };
    expect(result.think_sync).toBe(true);
    expect(result.think_batch_fallback).toBe(true);
    expect(result.final_answer).toContain('Batch fallback synthesis');
    const batchCall = gotPost.mock.calls.find((c) => String(c[0]).includes('/batches'));
    expect(batchCall).toBeTruthy();
    const syncThink = gotPost.mock.calls.find(
      (c) => String(c[0]).includes('chat/completions') && (c[1] as { json: { model?: string } }).json.model?.includes('sonnet')
    );
    expect(syncThink).toBeTruthy();
    expect((syncThink![1] as { json: { model: string } }).json.model).toBe('anthropic/claude-sonnet-5.5');
  });

  it('falls back to sync think when batch submit succeeds but poll returns 404', async () => {
    gotPost.mockImplementation((url: string, opts: { json: Record<string, unknown> }) => {
      const model = opts.json.model as string;
      if (String(url).includes('/batches')) {
        return Promise.resolve({ body: { id: 'batch-1791737547-test', status: 'validating' } });
      }
      if (model?.includes('haiku')) {
        return Promise.resolve({
          body: { choices: [{ message: { role: 'assistant', content: 'gathered' } }] },
        });
      }
      if (model?.includes('sonnet')) {
        return Promise.resolve({
          body: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '{"final_answer":"Poll fallback ok","evidence_requests":[]}',
                },
              },
            ],
          },
        });
      }
      return Promise.reject(new Error(`unexpected post ${url}`));
    });
    vi.spyOn(openRouterBatch, 'getOpenRouterBatchWhenReady').mockRejectedValue(
      new Error('OpenRouter batch poll (HTTP 404): Batch job batch-1791737547-test not found.')
    );
    vi.spyOn(openRouterBatch, 'extractBatchCompletionText').mockImplementation(() => 'unused');

    const jobs = new JobStore({ dbPath: ':memory:' });
    const job = jobs.create('poll 404 fallback', { job_kind: 'deferred_batch' });

    await runDeferredJob(
      job.id,
      {
        goal: 'poll 404 fallback',
        openrouter_api_key: 'or-key',
        gather_profile: GATHER_PROFILE,
        think_profile: BATCH_THINK,
      },
      jobs
    );

    const done = jobs.get(job.id);
    expect(done?.status).toBe('done');
    expect((done?.result as { think_batch_fallback?: boolean }).think_batch_fallback).toBe(true);
    expect((done?.result as { final_answer?: string }).final_answer).toContain('Poll fallback ok');
  });
});
