import { createHash } from 'crypto';
import got from 'got';

import { clients } from '@/mcp/mcp';
import {
  bindToolsForOpenAI,
  executeMcpFunctionCall,
  listMcpFunctionTools,
  OpenAIFunctionTool,
} from '@/multiAgent/toolBridge';

import type { EvidencePacket, EvidenceSource, ToolTraceEntry } from './schemas';
import { EVIDENCE_PACKET_SCHEMA_VERSION } from './schemas';

export type GatherAgentInput = {
  goal: string;
  contextPacket?: string;
  gatherModel: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  allowMcpClients?: string[];
  denyMcpClients?: string[];
  maxTurns: number;
  maxToolCalls: number;
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
  openaiApiKey?: string;
  openrouterApiKey?: string;
}): Promise<{ message: Record<string, unknown>; raw: unknown; resolve: (name: string) => string | undefined }> {
  const useOr = Boolean(args.openrouterApiKey);
  const apiKey = useOr ? args.openrouterApiKey! : args.openaiApiKey!;
  const url = useOr
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const { tools, resolve } = bindToolsForOpenAI(args.tools);
  const payload: Record<string, unknown> = {
    model: args.model,
    messages: args.messages,
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
  };
  const res = await got.post(url, {
    json: payload,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(useOr ? { 'HTTP-Referer': 'https://typingmind.com', 'X-Title': 'DeferredResearch' } : {}),
    },
    responseType: 'json',
    timeout: { request: 180_000 },
  });
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
  if (!input.openaiApiKey && !input.openrouterApiKey) {
    throw new Error('gather requires openai_api_key or openrouter_api_key');
  }
  const mcpTools = await listMcpFunctionTools(clients, {
    allow: input.allowMcpClients,
    deny: input.denyMcpClients,
  });
  const system = [
    'You are the Gather tier for a deferred research job.',
    'Use MCP tools when you need external facts. When enough evidence is collected, answer with a concise synthesis.',
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
      const exec = await executeMcpFunctionCall(clients, encoded, tc.function?.arguments);
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
