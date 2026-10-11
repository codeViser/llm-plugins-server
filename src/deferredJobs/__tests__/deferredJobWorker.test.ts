import { describe, expect, it, vi, beforeEach } from 'vitest';

import { JobStore } from '@/multiAgent/jobStore';

import { resumeInterruptedDeferredJobs, runDeferredJob, stashDeferredRunSecrets } from '../deferredJobWorker';
import * as gatherAgent from '../gatherAgent';
import * as openRouterBatch from '../openRouterBatch';

describe('deferredJobWorker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completes gather-only job with tools_invoked', async () => {
    vi.spyOn(gatherAgent, 'runGatherAgent').mockResolvedValue({
      packet: {
        schema_version: 1,
        goal: 'test',
        sources: [],
        tool_trace: [{ tool: 'mcp__test__tool', ok: true, chars: 100 }],
        gather_model: 'openai/gpt-4o-mini',
        packet_hash: 'abc',
      },
      toolsInvoked: ['mcp__test__tool'],
      finalAssistantText: 'gathered answer',
    });

    const jobs = new JobStore({ dbPath: ':memory:' });
    const job = jobs.create('test goal', { job_kind: 'deferred_batch', skip_batch: true });

    await runDeferredJob(
      job.id,
      {
        goal: 'test goal',
        gather_model: 'openai/gpt-4o-mini',
        openai_api_key: 'sk-test',
        skip_batch: true,
      },
      jobs
    );

    const done = jobs.get(job.id);
    expect(done?.status).toBe('done');
    const result = done?.result as { tools_invoked?: string[]; final_answer?: string };
    expect(result.tools_invoked).toEqual(['mcp__test__tool']);
    expect(result.final_answer).toBe('gathered answer');
  });

  it('runs think tier when batch completes with JSON final_answer', async () => {
    vi.spyOn(gatherAgent, 'runGatherAgent').mockResolvedValue({
      packet: {
        schema_version: 1,
        goal: 'think goal',
        sources: [],
        tool_trace: [],
        gather_model: 'openai/gpt-4o-mini',
        packet_hash: 'def',
      },
      toolsInvoked: [],
      finalAssistantText: 'preview',
    });
    vi.spyOn(openRouterBatch, 'submitOpenRouterBatch').mockResolvedValue({ id: 'batch-1', status: 'in_progress' });
    vi.spyOn(openRouterBatch, 'getOpenRouterBatch').mockResolvedValue({
      id: 'batch-1',
      status: 'completed',
      results: [
        {
          custom_id: 'x',
          response: {
            body: {
              choices: [{ message: { content: '{"final_answer":"synth","evidence_requests":[]}' } }],
            },
          },
        },
      ],
    });
    vi.spyOn(openRouterBatch, 'extractBatchCompletionText').mockReturnValue(
      '{"final_answer":"synth","evidence_requests":[]}'
    );

    const jobs = new JobStore({ dbPath: ':memory:' });
    const job = jobs.create('think goal', { job_kind: 'deferred_batch' });
    stashDeferredRunSecrets(job.id, { openrouter: 'or-key' });

    await runDeferredJob(
      job.id,
      {
        goal: 'think goal',
        gather_model: 'openai/gpt-4o-mini',
        think_model: 'openai/gpt-5.6-luna-pro:batch',
        openrouter_api_key: 'or-key',
      },
      jobs
    );

    const done = jobs.get(job.id);
    expect(done?.status).toBe('done');
    expect((done?.result as { final_answer?: string }).final_answer).toBe('synth');
  });

  it('resumeInterruptedDeferredJobs schedules batch_polling jobs', async () => {
    const jobs = new JobStore({ dbPath: ':memory:' });
    const job = jobs.create('resume me', {
      job_kind: 'deferred_batch',
      think_model: 'openai/gpt-5.6-luna-pro:batch',
      gather_model: 'openai/gpt-4o-mini',
      evidence_packet_snapshot: {
        schema_version: 1,
        goal: 'resume me',
        sources: [],
        tool_trace: [],
        gather_model: 'openai/gpt-4o-mini',
      },
      progress: {
        phase: 'batch_polling',
        updated_at: new Date().toISOString(),
        or_batch_id: 'batch-resume',
      },
    });
    stashDeferredRunSecrets(job.id, { openrouter: 'or-key' });

    vi.spyOn(openRouterBatch, 'getOpenRouterBatch').mockResolvedValue({
      id: 'batch-resume',
      status: 'completed',
      results: [],
    });
    vi.spyOn(openRouterBatch, 'extractBatchCompletionText').mockReturnValue(
      '{"final_answer":"from batch","evidence_requests":[]}'
    );

    resumeInterruptedDeferredJobs(jobs);
    await new Promise((r) => setTimeout(r, 50));

    const done = jobs.get(job.id);
    expect(done?.status).toBe('done');
    expect((done?.result as { final_answer?: string }).final_answer).toBe('from batch');
  });
});
