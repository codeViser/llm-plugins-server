import got from 'got';

import { env } from '@/common/utils/envConfig';

import { HOSTED_COLLABORATION_NAMES, isHostedCollaborationItem } from './hostedActions';
import { resolveMaxAgents } from './maxAgents';
import { resolveCouncilModel } from './modelResolve';
import { runBackgroundResponsesTurn } from './openaiBackgroundTurn';
import { redactSecrets, safeErrorMessage } from './redact';
import {
  DEFAULT_RESPONSES_REQUEST_TIMEOUT_MS,
  MAX_HTTP_ROUNDS,
  MIN_REQUEST_TIMEOUT_MS,
  OPENAI_POLL_HTTP_TIMEOUT_MS,
} from './timeouts';
import { buildJobToolRouter } from '@/executionSurface/compositeRouter';
import type { ToolCatalogV1 } from '@/executionSurface/types';

import {
  bindToolsForOpenAI,
  executeMcpFunctionCall,
  listMcpFunctionTools,
  McpListableClient,
} from './toolBridge';

const OPENAI_MULTI_AGENT_BETA = 'responses_multi_agent=v1';

export { DEFAULT_RESPONSES_REQUEST_TIMEOUT_MS, MAX_HTTP_ROUNDS };

export type ResponsesTransport = (args: {
  apiKey: string;
  body: Record<string, unknown>;
  /** Remaining run budget for this HTTP call (ms). */
  timeoutMs?: number;
}) => Promise<ResponsesApiResult>;

export type ResponsesOutputItem = {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string | Record<string, unknown>;
  status?: string;
  phase?: string;
  agent?: { agent_name?: string };
  content?: Array<{ type?: string; text?: string }>;
};

export type ResponsesApiResult = {
  id?: string;
  status?: string;
  output?: ResponsesOutputItem[];
  error?: { message?: string };
};

export type MultiAgentRunInput = {
  goal: string;
  contextPacket?: string;
  /** Plugin User Setting cap (per use case). */
  pluginMaxAgents?: number;
  /** Optional model request; cannot exceed pluginMaxAgents. */
  requestedAgents?: number;
  /** @deprecated alias of pluginMaxAgents */
  maxAgents?: number;
  model?: string;
  openaiApiKey?: string;
  timeoutSec?: number;
  allowMcpClients?: string[];
  denyMcpClients?: string[];
  tool_catalog_v1?: ToolCatalogV1 | null;
  jobId?: string;
};

export type MultiAgentRunResult = {
  answer: string;
  agentTree: Array<{ type?: string; name?: string; agent?: string; phase?: string }>;
  toolsInvoked: string[];
  maxAgents: number;
  pluginMaxAgents: number;
  requestedAgents?: number;
  maxAgentsClamped: boolean;
  model: string;
  reasoningEffort: string;
  rounds: number;
};

export type MultiAgentRunnerDeps = {
  clients: Map<string, { id: string; client: McpListableClient }>;
  transport?: ResponsesTransport;
  now?: () => number;
  defaultMaxAgents?: number;
  defaultModel?: string;
};

function extractText(item: ResponsesOutputItem): string {
  const parts = item.content ?? [];
  return parts
    .filter((part) => part.type === 'output_text' || part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .trim();
}

function extractFinalAnswer(output: ResponsesOutputItem[]): string {
  const rootFinal = output.filter(
    (item) =>
      item.type === 'message' &&
      (item.agent?.agent_name === '/root' || !item.agent?.agent_name) &&
      item.phase === 'final_answer'
  );
  const fromRoot = rootFinal.map(extractText).filter(Boolean).join('\n').trim();
  if (fromRoot) {
    return fromRoot;
  }
  const messages = output.filter((item) => item.type === 'message').map(extractText).filter(Boolean);
  return messages.join('\n').trim();
}

function extractFunctionCalls(output: ResponsesOutputItem[]): ResponsesOutputItem[] {
  return output.filter((item) => {
    if (isHostedCollaborationItem(item)) {
      return false;
    }
    if (item.name && HOSTED_COLLABORATION_NAMES.has(item.name)) {
      return false;
    }
    return item.type === 'function_call' || item.type === 'function_call_item';
  });
}

function attachStatus(error: Error, statusCode: number): Error {
  (error as Error & { statusCode: number }).statusCode = statusCode;
  return error;
}

async function openaiJson(args: {
  method: 'GET' | 'POST';
  path: string;
  apiKey: string;
  body?: Record<string, unknown>;
  timeoutMs: number;
}): Promise<ResponsesApiResult> {
  const url = args.path.startsWith('http') ? args.path : `https://api.openai.com${args.path}`;
  try {
    const response = await got(url, {
      method: args.method,
      ...(args.body !== undefined ? { json: args.body } : {}),
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': OPENAI_MULTI_AGENT_BETA,
      },
      responseType: 'json',
      throwHttpErrors: false,
      retry: { limit: 0 },
      timeout: { request: Math.max(5_000, args.timeoutMs) },
    });
    const payload = (response.body ?? {}) as ResponsesApiResult;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const message = payload?.error?.message || `OpenAI Responses HTTP ${response.statusCode}`;
      throw attachStatus(new Error(redactSecrets(message, [args.apiKey])), response.statusCode);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && typeof (error as Error & { statusCode?: number }).statusCode === 'number') {
      throw error;
    }
    const wrapped = new Error(safeErrorMessage(error, [args.apiKey]));
    const code = error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
    if (code) {
      (wrapped as Error & { code?: string }).code = code;
    }
    throw wrapped;
  }
}

function gotBackgroundHttp(apiKey: string) {
  return {
    create: (payload: Record<string, unknown>, createTimeoutMs: number) =>
      openaiJson({
        method: 'POST',
        path: '/v1/responses',
        apiKey,
        body: payload,
        timeoutMs: createTimeoutMs,
      }),
    retrieve: (id: string, pollTimeoutMs: number) =>
      openaiJson({
        method: 'GET',
        path: `/v1/responses/${encodeURIComponent(id)}`,
        apiKey,
        timeoutMs: pollTimeoutMs,
      }),
    cancel: async (id: string) => {
      try {
        await openaiJson({
          method: 'POST',
          path: `/v1/responses/${encodeURIComponent(id)}/cancel`,
          apiKey,
          body: {},
          timeoutMs: OPENAI_POLL_HTTP_TIMEOUT_MS,
        });
      } catch {
        // Best-effort cancel when our local budget expires.
      }
    },
  };
}

/**
 * Create+poll via OpenAI background mode. A single non-streaming POST used to
 * die at ~600s (`socket hang up`) while the 4h job budget still had hours left.
 */
export const defaultResponsesTransport: ResponsesTransport = async ({ apiKey, body, timeoutMs }) => {
  const result = await runBackgroundResponsesTurn({
    body,
    timeoutMs: timeoutMs ?? DEFAULT_RESPONSES_REQUEST_TIMEOUT_MS,
    http: gotBackgroundHttp(apiKey),
  });
  return result as ResponsesApiResult;
};

function packUserInput(goal: string, contextPacket?: string): string {
  const context = (contextPacket ?? '').trim();
  if (!context) {
    return goal;
  }
  return `${goal}\n\nContext packet from the TypingMind orchestrator (already gathered with local plugins/skills/MCP):\n${context}`;
}

const ROOT_INSTRUCTIONS = [
  'You are the root agent of an OpenAI Responses Multi-agent run attached to TypingMind.',
  'You may spawn subagents with the hosted collaboration actions. Do not ask the user to spawn them.',
  'Tools named mcp__<client>__<tool> are the live TypingMind MCP servers on the user’s Raspberry Pi connector.',
  'Prefer those tools over guessing. Subagents share the same tools.',
  'Return a synthesized answer with evidence and remaining uncertainty.',
].join(' ');

export async function runOpenAIMultiAgent(
  input: MultiAgentRunInput,
  deps: MultiAgentRunnerDeps
): Promise<MultiAgentRunResult> {
  const defaultMax = deps.defaultMaxAgents ?? env.MULTI_AGENT_DEFAULT_MAX_AGENTS;
  const defaultModel = deps.defaultModel ?? env.MULTI_AGENT_DEFAULT_MODEL;
  const resolved = resolveMaxAgents({
    pluginCap: input.pluginMaxAgents ?? input.maxAgents,
    requested: input.requestedAgents,
    fallbackDefault: defaultMax,
  });
  const maxAgents = resolved.value;
  const clamped = resolved.clampedToPlugin || resolved.clampedToSanity;
  const modelResolved = resolveCouncilModel(input.model, defaultModel);
  const resultCaps = {
    maxAgents,
    pluginMaxAgents: resolved.pluginCap,
    requestedAgents: resolved.requested,
    maxAgentsClamped: clamped,
    model: modelResolved.model,
    reasoningEffort: modelResolved.reasoning.effort,
  };
  const apiKey = (input.openaiApiKey && input.openaiApiKey.trim()) || env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('openai_api_key is required (TypingMind plugin User Settings, or OPENAI_API_KEY on the server)');
  }

  const transport = deps.transport ?? defaultResponsesTransport;
  const timeoutMs = Math.max(15, input.timeoutSec ?? 180) * 1000;
  const started = (deps.now ?? Date.now)();

  const router = input.tool_catalog_v1
    ? await buildJobToolRouter({
        catalog: input.tool_catalog_v1,
        allowMcpClients: input.allowMcpClients,
        denyMcpClients: input.denyMcpClients,
        jobId: input.jobId,
      })
    : null;
  const listed = router
    ? await router.listOpenAIFunctionTools()
    : await listMcpFunctionTools(deps.clients, {
        allow: input.allowMcpClients,
        deny: input.denyMcpClients,
      });
  const { tools, resolve: resolveToolName } = bindToolsForOpenAI(listed);

  const agentTree: MultiAgentRunResult['agentTree'] = [];
  const toolsInvoked: string[] = [];
  let previousResponseId: string | undefined;
  let nextInput: unknown = packUserInput(input.goal, input.contextPacket);
  let rounds = 0;
  let lastOutput: ResponsesOutputItem[] = [];

  while (rounds < MAX_HTTP_ROUNDS) {
    const remainingMs = timeoutMs - ((deps.now ?? Date.now)() - started);
    if (remainingMs <= MIN_REQUEST_TIMEOUT_MS) {
      throw new Error('multi-agent run timed out');
    }
    rounds += 1;

    const body: Record<string, unknown> = {
      model: modelResolved.model,
      reasoning: modelResolved.reasoning,
      instructions: ROOT_INSTRUCTIONS,
      tools,
      multi_agent: {
        enabled: true,
        max_concurrent_subagents: maxAgents,
      },
      store: true,
      input: nextInput,
    };
    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
    }

    let response: ResponsesApiResult;
    try {
      response = await transport({ apiKey, body, timeoutMs: remainingMs });
    } catch (error) {
      const message = safeErrorMessage(error, [apiKey]);
      if (/socket hang up/i.test(message)) {
        throw new Error(
          `${message}. OpenAI closed a long-held HTTP connection (~10 min). ` +
            'The runner uses background mode + short polls to avoid this; a remaining hang-up is a poll/create glitch, not the 4h job budget.'
        );
      }
      throw new Error(message);
    }

    if (response.id) {
      previousResponseId = response.id;
    }
    lastOutput = response.output ?? [];

    for (const item of lastOutput) {
      if (isHostedCollaborationItem(item) || item.type === 'message' || item.type === 'function_call') {
        agentTree.push({
          type: item.type,
          name: item.name,
          agent: item.agent?.agent_name,
          phase: item.phase,
        });
      }
    }

    const calls = extractFunctionCalls(lastOutput);
    if (calls.length === 0) {
      const answer = extractFinalAnswer(lastOutput);
      return {
        answer: answer || 'The multi-agent run finished without a text answer.',
        agentTree,
        toolsInvoked,
        ...resultCaps,
        rounds,
      };
    }

    const outputs = [];
    for (const call of calls) {
      const callId = call.call_id;
      if (!callId || !call.name) {
        continue;
      }
      toolsInvoked.push(call.name);
      const bridgeName = resolveToolName(call.name) ?? call.name;
      const executed = router
        ? await router.execute(bridgeName, call.arguments)
        : await executeMcpFunctionCall(deps.clients, bridgeName, call.arguments);
      outputs.push({
        type: 'function_call_output',
        call_id: callId,
        output: executed.text,
      });
    }

    if (outputs.length === 0) {
      const answer = extractFinalAnswer(lastOutput);
      return {
        answer: answer || 'The multi-agent run paused on hosted actions only.',
        agentTree,
        toolsInvoked,
        ...resultCaps,
        rounds,
      };
    }

    nextInput = outputs;
  }

  return {
    answer: extractFinalAnswer(lastOutput) || 'The multi-agent run hit the HTTP round limit.',
    agentTree,
    toolsInvoked,
    ...resultCaps,
    rounds,
  };
}
