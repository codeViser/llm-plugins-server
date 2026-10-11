import { describe, expect, it, vi, beforeEach } from 'vitest';

import { JobStore } from '@/multiAgent/jobStore';

import { resumeInterruptedDeferredJobs, runDeferredJob, stashDeferredRunSecrets } from '../deferredJobWorker';
import * as profileGather from '../profileGather';
import * as openRouterBatch from '../openRouterBatch';
import { BATCH_THINK_PROFILE, OR_GATHER_PROFILE } from './fixtures';

describe('deferredJobWorker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completes gather-only job with tools_invoked', async () => {
    vi.spyOn(profileGather, 'runProfileGather').mockResolvedValue({
      packet: {
        schema_version: 1,
        goal: 'test',
        sources: [],
        tool_trace: [{ tool: 'mcp__test__tool', ok: true, chars: 100 }],
        gather_model: 'openai/gpt-6-luna',
        packet_hash: 'abc',
      },
      toolsInvoked: ['mcp__test__tool'],
      finalAssistantText: 'gathered answer',
      config_echo: {
        gather_api_family: 'openrouter_chat_completions',
        gather_profile_hash: 'h',
        gather_ref: OR_GATHER_PROFILE.ref,
      },
    });

    const jobs = new JobStore({ dbPath: ':memory:' });
    const job = jobs.create('test goal', { job_kind: 'deferred_batch', skip_batch: true });

    await runDeferredJob(
      job.id,
      {
        goal: 'test goal',
        gather_profile: OR_GATHER_PROFILE,
        openrouter_api_key: 'or-key',
        skip_batch: true,
      },
      jobs
    );

    const done = jobs.get(job.id);
    expect(done?.status).toBe('done');
    expect((done?.result as { tools_invoked?: string[] }).tools_invoked).toEqual(['mcp__test__tool']);
  });

  it('runs think tier when batch profile set', async () => {
    vi.spyOn(profileGather, 'runProfileGather').mockResolvedValue({
      packet: {
        schema_version: 1,
        goal: 'think goal',
        sources: [],
        tool_trace: [],
        gather_model: 'openai/gpt-6-luna',
        packet_hash: 'def',
      },
      toolsInvoked: [],
      finalAssistantText: 'preview',
      config_echo: {
        gather_api_family: 'openrouter_chat_completions',
        gather_profile_hash: 'h',
        gather_ref: OR_GATHER_PROFILE.ref,
      },
    });
    vi.spyOn(openRouterBatch, 'submitOpenRouterBatch').mockResolvedValue({ id: 'batch-1', status: 'in_progress' });
    vi.spyOn(openRouterBatch, 'getOpenRouterBatch').mockResolvedValue({
      id: 'batch-1',
      status: 'completed',
      results: [],
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
        gather_profile: OR_GATHER_PROFILE,
        think_profile: BATCH_THINK_PROFILE,
        openrouter_api_key: 'or-key',
      },
      jobs
    );

    expect(jobs.get(job.id)?.status).toBe('done');
  });

  it('resumeInterruptedDeferredJobs schedules batch_polling jobs', async () => {
    const jobs = new JobStore({ dbPath: ':memory:' });
    const job = jobs.create('resume me', {
      job_kind: 'deferred_batch',
      gather_profile: OR_GATHER_PROFILE,
      think_profile: BATCH_THINK_PROFILE,
      evidence_packet_snapshot: {
        schema_version: 1,
        goal: 'resume me',
        sources: [],
        tool_trace: [],
        gather_model: 'x',
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

    expect(jobs.get(job.id)?.status).toBe('done');
  });
});
