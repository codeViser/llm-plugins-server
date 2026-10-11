import { pino } from 'pino';

import { env } from '@/common/utils/envConfig';
import { JobStore } from '@/multiAgent/jobStore';

import type { DeferredRunInput } from './deferredJobs.model';
import { buildThinkBatchBody } from './inferenceProfile';
import { runProfileGather } from './profileGather';
import {
  batchPollDelayMs,
  extractBatchCompletionText,
  getOpenRouterBatch,
  isTerminalBatchStatus,
  submitOpenRouterBatch,
} from './openRouterBatch';
import type { DeferredProgress, EvidencePacket, EvidenceRequest } from './schemas';

const logger = pino({ name: 'deferred-job-worker' });

const inFlight = new Set<string>();

/** Ephemeral API keys for in-process runs (not written to SQLite). */
const runSecrets = new Map<string, { openai?: string; openrouter?: string }>();

export function stashDeferredRunSecrets(
  jobId: string,
  secrets: { openai?: string; openrouter?: string }
): void {
  runSecrets.set(jobId, secrets);
}

function resolveKeys(jobId: string, input: DeferredRunInput): { openai?: string; openrouter?: string } {
  const stashed = runSecrets.get(jobId);
  return {
    openai: input.openai_api_key ?? stashed?.openai ?? (env.OPENAI_API_KEY || undefined),
    openrouter: input.openrouter_api_key ?? stashed?.openrouter ?? (env.OPENROUTER_API_KEY || undefined),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseThinkOutput(text: string): { final_answer: string; evidence_requests: EvidenceRequest[] } {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        final_answer?: string;
        evidence_requests?: EvidenceRequest[];
      };
      if (parsed.final_answer) {
        return {
          final_answer: parsed.final_answer,
          evidence_requests: parsed.evidence_requests ?? [],
        };
      }
    }
  } catch {
    /* fall through */
  }
  return { final_answer: text.trim(), evidence_requests: [] };
}

function thinkPrompt(packet: unknown, goal: string): string {
  return [
    'You are the Think tier. Synthesize a final answer from the evidence packet below.',
    'Respond with JSON only:',
    '{"final_answer":"...","evidence_requests":[]}',
    'Use evidence_requests only if critical gaps remain (max 3 items).',
    '',
    `Goal: ${goal}`,
    '',
    'Evidence packet:',
    JSON.stringify(packet, null, 2),
  ].join('\n');
}

async function pollBatchUntilDone(
  apiKey: string,
  batchId: string,
  customId: string,
  onProgress?: (status: string) => void
): Promise<{ text: string; batchStatus: string }> {
  let attempt = 0;
  while (true) {
    const status = await getOpenRouterBatch(apiKey, batchId);
    onProgress?.(status.status);
    if (isTerminalBatchStatus(status.status)) {
      if (status.status !== 'completed') {
        throw new Error(`OpenRouter batch ${batchId} ended with status ${status.status}`);
      }
      const text = extractBatchCompletionText(status, customId);
      return { text, batchStatus: status.status };
    }
    await new Promise((r) => setTimeout(r, batchPollDelayMs(attempt)));
    attempt++;
    if (attempt > 500) {
      throw new Error('OpenRouter batch poll exceeded max attempts');
    }
  }
}

function inputFromJob(jobId: string, jobs: JobStore, body: DeferredRunInput): DeferredRunInput {
  const job = jobs.get(jobId);
  const snap = job?.input;
  const keys = resolveKeys(jobId, body);
  return {
    goal: body.goal || job?.goal || snap?.goal || '',
    context_packet: body.context_packet,
    gather_profile: body.gather_profile ?? snap?.gather_profile,
    think_profile: body.think_profile ?? snap?.think_profile,
    gather_model: body.gather_model || snap?.gather_model,
    think_model: body.think_model || snap?.think_model,
    skip_batch: body.skip_batch ?? snap?.skip_batch,
    allow_mcp_clients: body.allow_mcp_clients ?? snap?.allow_mcp_clients,
    deny_mcp_clients: body.deny_mcp_clients ?? snap?.deny_mcp_clients,
    max_gather_turns: body.max_gather_turns ?? snap?.max_gather_turns,
    max_tool_calls: body.max_tool_calls ?? snap?.max_tool_calls,
    max_refine_rounds: body.max_refine_rounds ?? snap?.max_refine_rounds,
    openai_api_key: keys.openai,
    openrouter_api_key: keys.openrouter,
    progress: (body.progress ?? snap?.progress) as DeferredProgress | undefined,
  };
}

export async function runDeferredJob(jobId: string, input: DeferredRunInput, jobs: JobStore): Promise<void> {
  if (inFlight.has(jobId)) {
    return;
  }
  inFlight.add(jobId);
  const resolved = inputFromJob(jobId, jobs, input);

  const progress = (phase: DeferredProgress['phase'], extra: Partial<DeferredProgress> = {}, snapExtra?: Record<string, unknown>) => {
    jobs.updateProgress(
      jobId,
      {
        phase,
        updated_at: nowIso(),
        ...extra,
      },
      snapExtra
    );
  };

  try {
    const skipBatch = resolved.skip_batch === true;
    const storedProgress = resolved.progress;
    const resumeBatchId = storedProgress?.or_batch_id;
    const resumePhase = storedProgress?.phase;

    let gatherResult: Awaited<ReturnType<typeof runGatherAgent>> | undefined;
    let packet: EvidencePacket | undefined = jobs.get(jobId)?.input?.evidence_packet_snapshot as EvidencePacket | undefined;
    let refineRounds = jobs.get(jobId)?.input?.refine_rounds ?? 0;
    const maxRefine = resolved.max_refine_rounds ?? 1;
    const toolsInvoked: string[] = [];

    const gatherProfile = resolved.gather_profile;
    if (!gatherProfile) {
      throw new Error('gather_profile (inference_profile_v2) is required');
    }

    let configEcho: Record<string, unknown> = {};

    if (
      resumePhase === 'batch_polling' &&
      resumeBatchId &&
      packet &&
      resolved.openrouter_api_key &&
      resolved.think_profile
    ) {
      logger.info({ jobId, batchId: resumeBatchId }, 'resuming deferred job at batch_polling');
    } else {
      progress('gathering', { message: 'Running gather tier' });

      const gathered = await runProfileGather({
        profile: gatherProfile,
        goal: resolved.goal,
        contextPacket: resolved.context_packet,
        openaiApiKey: resolved.openai_api_key,
        openrouterApiKey: resolved.openrouter_api_key,
        allowMcpClients: resolved.allow_mcp_clients,
        denyMcpClients: resolved.deny_mcp_clients,
        maxTurns: resolved.max_gather_turns ?? 8,
        maxToolCalls: resolved.max_tool_calls ?? 12,
      });
      gatherResult = {
        packet: gathered.packet,
        toolsInvoked: gathered.toolsInvoked,
        finalAssistantText: gathered.finalAssistantText,
      };
      packet = gathered.packet;
      toolsInvoked.push(...gathered.toolsInvoked);
      configEcho = gathered.config_echo;

      const thinkProfile = resolved.think_profile;
      const useBatchThink =
        !skipBatch &&
        thinkProfile &&
        (thinkProfile.api_family === 'openrouter_batch' || thinkProfile.model_slug.includes(':batch'));

      if (!useBatchThink || !resolved.openrouter_api_key) {
        jobs.complete(jobId, {
          kind: 'deferred_batch',
          final_answer: gathered.finalAssistantText,
          evidence_packet: gathered.packet,
          tools_invoked: gathered.toolsInvoked,
          gather_only: true,
          config_echo: configEcho,
        });
        progress('done');
        return;
      }
    }

    if (!packet) {
      throw new Error('deferred job missing evidence packet');
    }

    while (true) {
      const customId = `${jobId}-think-${refineRounds}`;
      let batchId = resumePhase === 'batch_polling' && refineRounds === (jobs.get(jobId)?.input?.refine_rounds ?? 0)
        ? resumeBatchId
        : undefined;

      if (!batchId) {
        progress('batch_submitted', { message: 'Submitting OpenRouter batch' }, { evidence_packet_snapshot: packet, refine_rounds: refineRounds });
        const thinkProfile = resolved.think_profile!;
        const body = buildThinkBatchBody(thinkProfile, thinkPrompt(packet, resolved.goal));
        const submitted = await submitOpenRouterBatch({
          apiKey: resolved.openrouter_api_key!,
          endpoint: '/v1/chat/completions',
          model: thinkProfile.model_slug,
          customId,
          body,
        });
        batchId = submitted.id;
        jobs.updateProgress(
          jobId,
          {
            phase: 'batch_polling',
            updated_at: nowIso(),
            or_batch_id: submitted.id,
            or_batch_status: submitted.status,
          },
          { evidence_packet_snapshot: packet, refine_rounds: refineRounds }
        );
      } else {
        progress('batch_polling', { or_batch_id: batchId, message: 'Resuming batch poll' });
      }

      const { text } = await pollBatchUntilDone(
        resolved.openrouter_api_key!,
        batchId!,
        customId,
        (st) => {
          jobs.updateProgress(
            jobId,
            {
              phase: 'batch_polling',
              updated_at: nowIso(),
              or_batch_id: batchId,
              or_batch_status: st,
            },
            { evidence_packet_snapshot: packet, refine_rounds: refineRounds }
          );
        }
      );

      const parsed = parseThinkOutput(text);
      if (parsed.evidence_requests.length && refineRounds < maxRefine) {
        progress('refining', { message: `Executing ${parsed.evidence_requests.length} evidence requests` });
        refineRounds++;
        const extraOut = await runProfileGather({
          profile: gatherProfile,
          goal: `${resolved.goal}\n\nFollow-up evidence requests:\n${JSON.stringify(parsed.evidence_requests)}`,
          contextPacket: JSON.stringify(packet),
          openaiApiKey: resolved.openai_api_key,
          openrouterApiKey: resolved.openrouter_api_key,
          allowMcpClients: resolved.allow_mcp_clients,
          denyMcpClients: resolved.deny_mcp_clients,
          maxTurns: Math.min(4, resolved.max_gather_turns ?? 8),
          maxToolCalls: Math.min(6, resolved.max_tool_calls ?? 12),
        });
        const extra = {
          packet: extraOut.packet,
          toolsInvoked: extraOut.toolsInvoked,
        };
        toolsInvoked.push(...extra.toolsInvoked);
        packet = {
          ...extra.packet,
          sources: [...packet.sources, ...extra.packet.sources],
          tool_trace: [...packet.tool_trace, ...extra.packet.tool_trace],
        };
        continue;
      }

      const allTools = toolsInvoked.length ? toolsInvoked : gatherResult?.toolsInvoked ?? [];
      jobs.complete(jobId, {
        kind: 'deferred_batch',
        final_answer: parsed.final_answer,
        evidence_packet: packet,
        tools_invoked: allTools,
        think_model: resolved.think_profile?.model_slug ?? resolved.think_model,
        refine_rounds: refineRounds,
        raw_think_excerpt: text.slice(0, 2000),
        config_echo: {
          ...configEcho,
          think_api_family: resolved.think_profile?.api_family,
          think_profile_hash: resolved.think_profile?.profile_hash,
          think_ref: resolved.think_profile?.ref,
        },
      });
      progress('done');
      break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ jobId, err: message }, 'deferred job failed');
    jobs.fail(jobId, message);
    jobs.updateProgress(jobId, { phase: 'failed', updated_at: nowIso(), message });
  } finally {
    inFlight.delete(jobId);
    runSecrets.delete(jobId);
  }
}

export function resumeInterruptedDeferredJobs(jobs: JobStore): void {
  for (const row of jobs.recent(50)) {
    if (row.status !== 'running') {
      continue;
    }
    const phase = row.input?.progress && typeof row.input.progress === 'object'
      ? (row.input.progress as { phase?: string }).phase
      : undefined;
    if (phase !== 'batch_polling' && phase !== 'batch_submitted' && phase !== 'gathering') {
      continue;
    }
    const keys = resolveKeys(row.id, {});
    if (phase !== 'gathering' && !keys.openrouter) {
      logger.warn({ jobId: row.id }, 'cannot resume deferred job without openrouter key');
      continue;
    }
    logger.info({ jobId: row.id, phase }, 'resuming interrupted deferred job');
    void runDeferredJob(row.id, { goal: row.goal ?? '' }, jobs);
  }
}
