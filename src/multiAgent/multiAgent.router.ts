import { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pino } from 'pino';

import { env } from '@/common/utils/envConfig';
import { clients } from '@/mcp/mcp';

import { appliedCouncilConfig, configFromJobInput, CouncilConfig, mergeCouncilConfig } from './councilConfig';
import { connectorAuthMiddleware } from './connectorAuth';
import { JobStore } from './jobStore';
import { contextPacketToString, MultiAgentPollRequestSchema, MultiAgentRunRequestSchema } from './multiAgent.model';
import { MultiAgentRunInput, MultiAgentRunResult, runOpenAIMultiAgent } from './openaiResponsesMultiAgent';
import { safeErrorMessage } from './redact';
import { DEFAULT_ASYNC_TIMEOUT_SEC } from './timeouts';
import { listMcpFunctionTools, OpenAIFunctionTool } from './toolBridge';

const logger = pino({ name: 'multi-agent' });

export type MultiAgentRouterDeps = {
  authToken: string;
  run?: (input: MultiAgentRunInput) => Promise<MultiAgentRunResult>;
  listTools?: (options?: { allow?: string[]; deny?: string[] }) => Promise<OpenAIFunctionTool[]>;
  jobStore?: JobStore;
};

function resultPayload(result: MultiAgentRunResult, config?: CouncilConfig) {
  const payload = {
    answer: result.answer,
    agent_tree: result.agentTree,
    tools_invoked: result.toolsInvoked,
    max_agents: result.maxAgents,
    plugin_max_agents: result.pluginMaxAgents,
    requested_agents: result.requestedAgents ?? null,
    max_agents_clamped: result.maxAgentsClamped,
    model: result.model,
    rounds: result.rounds,
    timeout_sec: config?.timeout_sec,
    config: config
      ? {
          model: result.model,
          reasoning_effort: result.reasoningEffort ?? config.reasoning_effort,
          plugin_max_agents: result.pluginMaxAgents,
          requested_agents: result.requestedAgents ?? null,
          max_agents: result.maxAgents,
          max_agents_clamped: result.maxAgentsClamped,
          timeout_sec: config.timeout_sec,
        }
      : {
          model: result.model,
          reasoning_effort: result.reasoningEffort,
          plugin_max_agents: result.pluginMaxAgents,
          requested_agents: result.requestedAgents ?? null,
          max_agents: result.maxAgents,
          max_agents_clamped: result.maxAgentsClamped,
        },
  };
  return payload;
}

export function createMultiAgentRouter(deps: MultiAgentRouterDeps): Router {
  const router = Router();
  const auth = connectorAuthMiddleware(deps.authToken || 'dummy-token');
  const jobs = deps.jobStore ?? new JobStore();

  const run =
    deps.run ??
    ((input: MultiAgentRunInput) =>
      runOpenAIMultiAgent(input, {
        clients,
      }));

  const listTools =
    deps.listTools ??
    ((options?: { allow?: string[]; deny?: string[] }) => listMcpFunctionTools(clients, options));

  function councilConfigFromBody(body: ReturnType<typeof MultiAgentRunRequestSchema.parse>, timeoutSec: number): CouncilConfig {
    return appliedCouncilConfig({
      model: body.model,
      maxAgents: body.max_agents,
      requestedAgents: body.requested_agents,
      timeoutSec,
      fallbackModel: env.MULTI_AGENT_DEFAULT_MODEL,
      fallbackMaxAgents: env.MULTI_AGENT_DEFAULT_MAX_AGENTS,
      fallbackTimeoutSec: timeoutSec,
    });
  }

  function jobPublicConfig(job: { input?: Parameters<typeof configFromJobInput>[0]; result?: unknown; status: string }): CouncilConfig | undefined {
    const fromResult = job.status === 'done' && job.result && typeof job.result === 'object' ? (job.result as Record<string, unknown>) : null;
    return mergeCouncilConfig(fromResult, configFromJobInput(job.input));
  }

  function buildRunInput(body: ReturnType<typeof MultiAgentRunRequestSchema.parse>): MultiAgentRunInput {
    return {
      goal: body.goal,
      contextPacket: contextPacketToString(body.context_packet),
      pluginMaxAgents: body.max_agents,
      requestedAgents: body.requested_agents,
      model: body.model,
      openaiApiKey: body.openai_api_key,
      timeoutSec: body.timeout_sec,
      allowMcpClients: body.allow_mcp_clients,
      denyMcpClients: body.deny_mcp_clients,
      tool_catalog_v1: body.tool_catalog_v1 ?? null,
    };
  }

  router.post('/run', auth, async (req: Request, res: Response) => {
    const parsed = MultiAgentRunRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: 'Invalid multi-agent request',
        details: parsed.error.issues.map((issue) => issue.message),
      });
    }

    const body = parsed.data;
    const apiKey = body.openai_api_key;

    if (body.dry_run) {
      let mcpTools: OpenAIFunctionTool[] = [];
      let mcpListError: string | undefined;
      try {
        mcpTools = await listTools({
          allow: body.allow_mcp_clients,
          deny: body.deny_mcp_clients,
        });
      } catch (error) {
        mcpListError = safeErrorMessage(error);
      }

      let dryConfig: CouncilConfig;
      try {
        dryConfig = councilConfigFromBody(body, body.timeout_sec ?? 15);
      } catch (error) {
        return res.status(StatusCodes.BAD_REQUEST).json({ error: safeErrorMessage(error) });
      }
      const dryPayload = {
        dry_run: true,
        openai_called: false,
        goal: body.goal,
        model: dryConfig.model,
        max_agents: dryConfig.max_agents,
        plugin_max_agents: dryConfig.plugin_max_agents,
        requested_agents: dryConfig.requested_agents,
        max_agents_clamped: dryConfig.max_agents_clamped,
        timeout_sec: dryConfig.timeout_sec,
        config: dryConfig,
        mcp_tool_count: mcpTools.length,
        mcp_tools: mcpTools.map((tool) => tool.name),
        ...(mcpListError ? { mcp_list_error: mcpListError } : {}),
      };

      // Async + dry_run lets the client integration-test the job/poll transport
      // with zero OpenAI cost.
      if (body.async) {
        const job = jobs.create(body.goal);
        jobs.complete(job.id, dryPayload);
        return res.status(StatusCodes.ACCEPTED).json({ job_id: job.id, status: 'running' });
      }

      return res.status(StatusCodes.OK).json(dryPayload);
    }

    // Async: start the run in the background, return a job id immediately so no
    // single HTTP request stays open long enough for Cloudflare/tunnel to drop it.
    if (body.async) {
      const timeoutSec = body.timeout_sec ?? DEFAULT_ASYNC_TIMEOUT_SEC;
      let config: CouncilConfig;
      try {
        config = councilConfigFromBody(body, timeoutSec);
      } catch (error) {
        return res.status(StatusCodes.BAD_REQUEST).json({ error: safeErrorMessage(error, apiKey ? [apiKey] : []) });
      }
      const job = jobs.create(body.goal, {
        goal: body.goal,
        context_packet: body.context_packet ?? undefined,
        model: config.model,
        reasoning_effort: config.reasoning_effort,
        max_agents: config.plugin_max_agents,
        requested_agents: config.requested_agents ?? undefined,
        timeout_sec: config.timeout_sec,
        applied_max_agents: config.max_agents,
      });
      const input = buildRunInput(body);
      input.jobId = job.id;
      input.model = config.model;
      input.pluginMaxAgents = config.plugin_max_agents;
      input.requestedAgents = config.requested_agents ?? undefined;
      input.timeoutSec = timeoutSec;
      Promise.resolve()
        .then(() => run(input))
        .then((result) => {
          jobs.complete(job.id, resultPayload(result, config));
          logger.info(
            { jobId: job.id, rounds: result.rounds, model: result.model, toolCount: result.toolsInvoked.length },
            'multi-agent async run finished'
          );
        })
        .catch((error) => {
          const message = safeErrorMessage(error, apiKey ? [apiKey] : []);
          jobs.fail(job.id, message);
          logger.error({ jobId: job.id, err: message }, 'multi-agent async run failed');
        });
      return res.status(StatusCodes.ACCEPTED).json({
        job_id: job.id,
        status: 'running',
        config,
        model: config.model,
        max_agents: config.max_agents,
        plugin_max_agents: config.plugin_max_agents,
        requested_agents: config.requested_agents,
        timeout_sec: config.timeout_sec,
      });
    }

    // Synchronous path (direct/curl use). May be slow; not for the browser plugin.
    try {
      const timeoutSec = body.timeout_sec ?? 180;
      const config = councilConfigFromBody(body, timeoutSec);
      const result = await run(buildRunInput(body));
      logger.info(
        {
          rounds: result.rounds,
          maxAgents: result.maxAgents,
          model: result.model,
          toolCount: result.toolsInvoked.length,
        },
        'multi-agent run finished'
      );
      return res.status(StatusCodes.OK).json(resultPayload(result, config));
    } catch (error) {
      const message = safeErrorMessage(error, apiKey ? [apiKey] : []);
      logger.error({ err: message }, 'multi-agent run failed');
      return res.status(StatusCodes.BAD_GATEWAY).json({ error: message });
    }
  });

  router.post('/poll', auth, (req: Request, res: Response) => {
    const parsed = MultiAgentPollRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: 'Invalid poll request',
        details: parsed.error.issues.map((issue) => issue.message),
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
    const base = { job_id: job.id, goal: job.goal ?? '', config: jobPublicConfig(job) };
    if (job.status === 'running') {
      return res.status(StatusCodes.OK).json({ status: 'running', ...base });
    }
    if (job.status === 'error') {
      return res.status(StatusCodes.OK).json({ status: 'error', error: job.error ?? 'run failed', ...base });
    }
    return res.status(StatusCodes.OK).json({ status: 'done', result: job.result, ...base });
  });

  // List recent councils so the user/model can retrieve a result even without
  // remembering a job_id ("did my research finish?").
  router.post('/recent', auth, (_req: Request, res: Response) => {
    const jobsList = jobs.recent(10).map((j) => ({
      job_id: j.id,
      status: j.status,
      goal: j.goal,
      started_at: new Date(j.createdAt).toISOString(),
      updated_at: new Date(j.updatedAt).toISOString(),
      config: configFromJobInput(j.input),
    }));
    return res.status(StatusCodes.OK).json({ jobs: jobsList });
  });

  return router;
}

const authToken = env.MCP_AUTH_TOKEN;
if (!authToken) {
  logger.warn('MCP_AUTH_TOKEN is not set. /multi-agent routes will use the dummy test token.');
}

export const multiAgentRouter = createMultiAgentRouter({
  authToken: authToken || 'dummy-token',
});
