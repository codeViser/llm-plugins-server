import { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pino } from 'pino';

import { connectorAuthMiddleware } from '@/multiAgent/connectorAuth';
import { JobStore } from '@/multiAgent/jobStore';
import { safeErrorMessage } from '@/multiAgent/redact';

import {
  contextPacketToString,
  DeferredPollRequestSchema,
  DeferredRunRequestSchema,
  type DeferredRunInput,
} from './deferredJobs.model';
import { runDeferredJob, stashDeferredRunSecrets } from './deferredJobWorker';
import { clients } from '@/mcp/mcp';
import { listMcpFunctionTools } from '@/multiAgent/toolBridge';

import { normalizeDeferredTierProfiles, profileModelId } from './inferenceProfile';
import { resolveMcpAllowList } from './mcpAllow';
import { toolsParityReport } from './parityTools';
import { RESEARCH_COUNCIL_CLIENT_ID } from '@/multiAgent/researchCouncilId';

const logger = pino({ name: 'deferred-jobs' });

export type DeferredJobsRouterDeps = {
  authToken: string;
  jobStore?: JobStore;
};

export function createDeferredJobsRouter(deps: DeferredJobsRouterDeps): Router {
  const router = Router();
  const auth = connectorAuthMiddleware(deps.authToken || 'dummy-token');
  const jobs = deps.jobStore ?? new JobStore();

  router.post('/run', auth, async (req: Request, res: Response) => {
    const parsed = DeferredRunRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: 'Invalid deferred job request',
        details: parsed.error.issues.map((i) => {
          const path = i.path.length ? i.path.join('.') : 'body';
          return `${path}: ${i.message}`;
        }),
      });
    }
    const body = parsed.data;
    const tierProfiles = normalizeDeferredTierProfiles({
      gather_profile: body.gather_profile,
      think_profile: body.think_profile,
    });
    const gatherProfile = tierProfiles.gather_profile;
    const thinkProfile = tierProfiles.think_profile;

    const piClientIds = [...clients.keys()].filter((id) => id !== RESEARCH_COUNCIL_CLIENT_ID);
    const { allow: resolvedAllow, missingOnPi } = resolveMcpAllowList({
      piClientIds,
      tmContext: body.tm_execution_context,
      explicitAllow: body.allow_mcp_clients,
    });

    const listed = await listMcpFunctionTools(clients, {
      allow: resolvedAllow,
      deny: body.deny_mcp_clients,
    });
    const parity = toolsParityReport({
      tm_enabled_plugin_count: body.tm_enabled_plugin_count,
      tm_execution_context: body.tm_execution_context,
      pi_tool_count: listed.length,
      mcp_missing_on_pi: missingOnPi,
      parity_strict: body.parity_strict === true,
    });

    if (!parity.ok) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: 'Tool/MCP parity gate failed',
        tools_parity: parity,
        mcp_missing_on_pi: missingOnPi,
      });
    }

    if (body.dry_run) {
      return res.status(StatusCodes.OK).json({
        dry_run: true,
        goal: body.goal,
        gather_profile: gatherProfile,
        think_profile: thinkProfile ?? null,
        skip_batch: Boolean(body.skip_batch),
        allow_mcp_clients_resolved: resolvedAllow ?? null,
        tools_parity: parity,
        mcp_missing_on_pi: missingOnPi,
      });
    }

    const input: DeferredRunInput = {
      ...body,
      gather_profile: gatherProfile,
      think_profile: thinkProfile,
      allow_mcp_clients: resolvedAllow,
      context_packet: contextPacketToString(body.context_packet),
      progress: { phase: 'gathering', updated_at: new Date().toISOString() },
    };

    const job = jobs.create(body.goal, {
      goal: body.goal,
      job_kind: 'deferred_batch',
      context_packet: body.context_packet,
      gather_model: gatherProfile.model_slug,
      think_model: thinkProfile?.model_slug,
      skip_batch: body.skip_batch,
      progress: input.progress,
      allow_mcp_clients: resolvedAllow,
      deny_mcp_clients: body.deny_mcp_clients,
      max_gather_turns: body.max_gather_turns,
      max_tool_calls: body.max_tool_calls,
      max_refine_rounds: body.max_refine_rounds,
      gather_profile: gatherProfile,
      think_profile: thinkProfile,
    });

    stashDeferredRunSecrets(job.id, {
      openai: body.openai_api_key,
      openrouter: body.openrouter_api_key,
    });

    const runInput = { ...input };
    Promise.resolve()
      .then(() => runDeferredJob(job.id, runInput, jobs))
      .catch((err) => {
        const message = safeErrorMessage(err);
        jobs.fail(job.id, message);
        logger.error({ jobId: job.id, err: message }, 'deferred job crashed');
      });

    return res.status(StatusCodes.ACCEPTED).json({
      job_id: job.id,
      status: 'running',
      kind: 'deferred_batch',
      gather_model: profileModelId(gatherProfile),
      gather_api_family: gatherProfile.api_family,
      think_model: thinkProfile ? profileModelId(thinkProfile) : null,
      tools_parity: parity,
    });
  });

  router.post('/poll', auth, (req: Request, res: Response) => {
    const parsed = DeferredPollRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: 'Invalid poll request',
        details: parsed.error.issues.map((i) => i.message),
      });
    }
    const job = jobs.get(parsed.data.job_id);
    if (!job) {
      return res.status(StatusCodes.NOT_FOUND).json({
        status: 'unknown',
        job_id: parsed.data.job_id,
        error: 'Unknown or expired job_id',
      });
    }
    const base = {
      job_id: job.id,
      goal: job.goal ?? '',
      kind: job.input?.job_kind ?? 'deferred_batch',
      progress: job.input?.progress,
    };
    if (job.status === 'running') {
      return res.status(StatusCodes.OK).json({ status: 'running', ...base });
    }
    if (job.status === 'error') {
      return res.status(StatusCodes.OK).json({ status: 'error', error: job.error ?? 'failed', ...base });
    }
    return res.status(StatusCodes.OK).json({ status: 'done', result: job.result, ...base });
  });

  router.post('/recent', auth, (_req: Request, res: Response) => {
    const jobsList = jobs.recent(15).map((j) => ({
      job_id: j.id,
      status: j.status,
      goal: j.goal,
      kind: j.input?.job_kind ?? 'council',
      progress: j.input?.progress,
      started_at: new Date(j.createdAt).toISOString(),
      updated_at: new Date(j.updatedAt).toISOString(),
    }));
    return res.status(StatusCodes.OK).json({ jobs: jobsList });
  });

  return router;
}
