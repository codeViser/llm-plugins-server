import { createHash } from 'crypto';
import got from 'got';

import { buildJobToolRouter } from '@/executionSurface/compositeRouter';
import type { ExecutionResolutionEntry, HandoffRelayMode } from '@/executionSurface/handoffResolution';
import type { JobToolRouter, ToolCatalogV1 } from '@/executionSurface/types';
import {
  bindToolsForOpenAI,
  OpenAIFunctionTool,
} from '@/multiAgent/toolBridge';

import type { InferenceProfileV2 } from './inferenceProfile';
import { buildOpenRouterChatBody } from './inferenceProfile';
import type { EvidencePacket, EvidenceSource, ToolTraceEntry } from './schemas';
import { EVIDENCE_PACKET_SCHEMA_VERSION } from './schemas';
import {
  applyReasoningToChatBody,
  resolveGatherProvider,
  type GatherProvider,
} from './reasoningParams';
import { formatProviderHttpError } from './providerHttpError';
import { gatherSystemContent } from './tierInstructions';

export type GatherAgentInput = {
  goal: string;
  contextPacket?: string;
  gatherModel: string;
  gatherProvider?: string;
  gatherReasoningEffort?: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  allowMcpClients?: string[];
  denyMcpClients?: string[];
  maxTurns: number;
  maxToolCalls: number;
  profile?: InferenceProfileV2;
  toolCatalog?: ToolCatalogV1 | null;
  jobId?: string;
  toolRouter?: JobToolRouter;
  relayMode?: HandoffRelayMode;
  executionResolution?: ExecutionResolutionEntry[];
};

export type GatherAgentResult = {
  packet: EvidencePacket;
  toolsInvoked: string[];
  finalAssistantText: string;
};

type ChatMessage = Record<string, unknown>;

async function chatCompletionRound(args: {
  messages: ChatMessage[];
  tools: OpenAIFunctionTool[];
  model: string;
  provider: GatherProvider;
  reasoningEffort?: string;
  profile?: InferenceProfileV2;
  openaiApiKey?: string;
  openrouterApiKey?: string;
}): Promise<{ message: Record<string, unknown>; raw: unknown; resolve: (name: string) => string | undefined }> {
  const useOr = args.provider === 'openrouter';
  const apiKey = useOr ? args.openrouterApiKey! : args.openaiApiKey!;
  const url = useOr
    ? args.profile?.endpoint || 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const { tools, resolve } = bindToolsForOpenAI(args.tools);
  const oaiTools = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const payload: Record<string, unknown> = args.profile
    ? buildOpenRouterChatBody(args.profile, args.messages, oaiTools)
    : {
        model: args.model,
        messages: args.messages,
        tools: oaiTools,
      };
  if (!args.profile) {
    applyReasoningToChatBody(args.provider, payload, args.reasoningEffort);
  }
  const postOnce = (json: Record<string, unknown>) =>
    got.post(url, {
      json,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(useOr ? { 'HTTP-Referer': 'https://typingmind.com', 'X-Title': 'DeferredResearch' } : {}),
      },
      responseType: 'json',
      timeout: { request: 180_000 },
    });

  let res;
  try {
    res = await postOnce(payload);
  } catch (error) {
    const status = (error as { response?: { statusCode?: number } })?.response?.statusCode;
    if (status === 400 && payload.reasoning_effort != null) {
      const { reasoning_effort: _r, reasoning: _o, ...retryPayload } = payload;
      try {
        res = await postOnce(retryPayload);
      } catch (retryError) {
        throw new Error(
          formatProviderHttpError(retryError, useOr ? 'OpenRouter gather chat' : 'OpenAI gather chat')
        );
      }
    } else {
      throw new Error(
        formatProviderHttpError(error, useOr ? 'OpenRouter gather chat' : 'OpenAI gather chat')
      );
    }
  }
  const raw = res.body as {
    choices?: Array<{ message?: Record<string, unknown> }>;
  };
  const message = raw.choices?.[0]?.message ?? {};
  return { message, raw, resolve };
}

function packetHash(packet: Omit<EvidencePacket, 'packet_hash'>): string {
  return createHash('sha256').update(JSON.stringify(packet)).digest('hex').slice(0, 16);
}

export async function runGatherAgent(input: GatherAgentInput): Promise<GatherAgentResult> {
  const provider = resolveGatherProvider({
    gatherProvider: input.gatherProvider,
    gatherModel: input.gatherModel,
    hasOpenaiKey: Boolean(input.openaiApiKey),
    hasOpenrouterKey: Boolean(input.openrouterApiKey),
  });
  if (provider === 'openai' && !input.openaiApiKey) {
    throw new Error('gather_provider=openai requires openai_api_key in plugin settings');
  }
  if (provider === 'openrouter' && !input.openrouterApiKey) {
    throw new Error('gather_provider=openrouter requires openrouter_api_key in plugin settings');
  }
  const router =
    input.toolRouter ??
    (await buildJobToolRouter({
      catalog: input.toolCatalog,
      allowMcpClients: input.allowMcpClients,
      denyMcpClients: input.denyMcpClients,
      jobId: input.jobId,
      relayMode: input.relayMode,
      executionResolution: input.executionResolution,
    }));
  const mcpTools = await router.listOpenAIFunctionTools();
  const system = input.profile
    ? gatherSystemContent(input.profile, input.contextPacket)
    : [
        'You are the Gather tier for a deferred research job. Use MCP tools when you need external facts.',
        input.contextPacket ? `Context from TypingMind:\n${input.contextPacket}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: input.goal },
  ];

  const toolsInvoked: string[] = [];
  const toolTrace: ToolTraceEntry[] = [];
  const sources: EvidenceSource[] = [];
  let toolCallsUsed = 0;
  let lastAssistant = '';

  for (let turn = 0; turn < input.maxTurns; turn++) {
    const { message, resolve } = await chatCompletionRound({
      messages,
      tools: mcpTools,
      model: input.gatherModel,
      provider,
      reasoningEffort: input.gatherReasoningEffort,
      profile: input.profile,
      openaiApiKey: input.openaiApiKey,
      openrouterApiKey: input.openrouterApiKey,
    });

    const content = typeof message.content === 'string' ? message.content : '';
    const toolCalls = (message.tool_calls as Array<{ id?: string; function?: { name?: string; arguments?: string } }>) ?? [];

    if (!toolCalls.length) {
      lastAssistant = content;
      break;
    }

    messages.push(message);
    for (const tc of toolCalls) {
      if (toolCallsUsed >= input.maxToolCalls) {
        break;
      }
      const openaiName = tc.function?.name ?? 'unknown';
      const encoded = resolve(openaiName) ?? openaiName;
      toolsInvoked.push(encoded);
      toolCallsUsed++;
      const exec = await router.execute(encoded, tc.function?.arguments);
      toolTrace.push({ tool: encoded, ok: exec.ok, chars: exec.text.length });
      if (exec.ok && exec.text.length > 40) {
        sources.push({ snippet: exec.text.slice(0, 2000), tool: encoded });
      }
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: exec.text,
      });
    }
  }

  const basePacket = {
    schema_version: EVIDENCE_PACKET_SCHEMA_VERSION,
    goal: input.goal,
    sources,
    tool_trace: toolTrace,
    gather_model: input.gatherModel,
    synthesis_preview: lastAssistant.slice(0, 4000),
  };
  const packet: EvidencePacket = {
    ...basePacket,
    packet_hash: packetHash(basePacket),
  };

  return { packet, toolsInvoked, finalAssistantText: lastAssistant };
}
