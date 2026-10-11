import got from 'got';

import { buildJobToolRouter } from '@/executionSurface/compositeRouter';
import type { ExecutionResolutionEntry, HandoffRelayMode } from '@/executionSurface/handoffResolution';
import type { ToolCatalogV1 } from '@/executionSurface/types';
import { bindToolsForOpenAI } from '@/multiAgent/toolBridge';
import { runBackgroundResponsesTurn } from '@/multiAgent/openaiBackgroundTurn';

import type { InferenceProfileV2 } from './inferenceProfile';
import { buildOpenAiResponsesBody } from './inferenceProfile';
import { composeTierInstructions, GATHER_TIER_ADDENDUM } from './tierInstructions';
import type { EvidencePacket, ToolTraceEntry } from './schemas';
import { EVIDENCE_PACKET_SCHEMA_VERSION } from './schemas';
import { createHash } from 'crypto';

export type ProfileGatherResult = {
  packet: EvidencePacket;
  toolsInvoked: string[];
  finalAssistantText: string;
  api_family: string;
};

function packetHash(packet: Omit<EvidencePacket, 'packet_hash'>): string {
  return createHash('sha256').update(JSON.stringify(packet)).digest('hex').slice(0, 16);
}

function extractTextFromOutput(output: Array<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const item of output) {
    if (item.type !== 'message') continue;
    const content = item.content as Array<{ type?: string; text?: string }> | undefined;
    for (const c of content ?? []) {
      if (c.text) parts.push(c.text);
    }
  }
  return parts.join('\n').trim();
}

function extractFunctionCalls(output: Array<Record<string, unknown>>) {
  return output.filter((item) => item.type === 'function_call' || item.type === 'function_call_item');
}

async function responsesHttp(apiKey: string) {
  return {
    create: (body: Record<string, unknown>, timeoutMs: number) =>
      got
        .post('https://api.openai.com/v1/responses', {
          json: { ...body, background: true, store: true },
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          responseType: 'json',
          timeout: { request: timeoutMs },
        })
        .then((r) => r.body as Record<string, unknown>),
    retrieve: (id: string, timeoutMs: number) =>
      got
        .get(`https://api.openai.com/v1/responses/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          responseType: 'json',
          timeout: { request: timeoutMs },
        })
        .then((r) => r.body as Record<string, unknown>),
  };
}

export async function runResponsesProfileGather(args: {
  profile: InferenceProfileV2;
  goal: string;
  contextPacket?: string;
  openaiApiKey: string;
  allowMcpClients?: string[];
  denyMcpClients?: string[];
  maxTurns: number;
  maxToolCalls: number;
  toolCatalog?: ToolCatalogV1 | null;
  jobId?: string;
  relayMode?: HandoffRelayMode;
  executionResolution?: ExecutionResolutionEntry[];
}): Promise<ProfileGatherResult> {
  const router = await buildJobToolRouter({
    catalog: args.toolCatalog,
    allowMcpClients: args.allowMcpClients,
    denyMcpClients: args.denyMcpClients,
    jobId: args.jobId,
    relayMode: args.relayMode,
    executionResolution: args.executionResolution,
  });
  const mcpTools = await router.listOpenAIFunctionTools();
  const { tools: oaiTools, resolve } = bindToolsForOpenAI(mcpTools);

  const userText = [
    args.goal,
    args.contextPacket ? `\n\nContext from TypingMind:\n${args.contextPacket}` : '',
  ].join('');

  let nextInput: unknown = userText;
  const toolsInvoked: string[] = [];
  const toolTrace: ToolTraceEntry[] = [];
  const sources: { snippet: string; tool?: string }[] = [];
  let lastAssistant = '';
  let toolCallsUsed = 0;

  for (let turn = 0; turn < args.maxTurns; turn++) {
    const body = buildOpenAiResponsesBody(
      {
        ...args.profile,
        instructions: composeTierInstructions(args.profile.instructions, GATHER_TIER_ADDENDUM),
      },
      nextInput,
      oaiTools
    );
    const result = await runBackgroundResponsesTurn({
      body,
      timeoutMs: 180_000,
      http: await responsesHttp(args.openaiApiKey),
    });
    const output = (result.output ?? []) as Array<Record<string, unknown>>;
    const calls = extractFunctionCalls(output);
    if (!calls.length) {
      lastAssistant = extractTextFromOutput(output);
      break;
    }
    const outputs: unknown[] = [];
    for (const call of calls) {
      if (toolCallsUsed >= args.maxToolCalls) break;
      const name = String(call.name ?? '');
      const callId = String(call.call_id ?? '');
      if (!name || !callId) continue;
      const bridge = resolve(name) ?? name;
      toolsInvoked.push(bridge);
      toolCallsUsed++;
      const exec = await router.execute(bridge, call.arguments);
      toolTrace.push({ tool: bridge, ok: exec.ok, chars: exec.text.length });
      if (exec.ok && exec.text.length > 40) {
        sources.push({ snippet: exec.text.slice(0, 2000), tool: bridge });
      }
      outputs.push({ type: 'function_call_output', call_id: callId, output: exec.text });
    }
    if (!outputs.length) {
      lastAssistant = extractTextFromOutput(output);
      break;
    }
    nextInput = outputs;
  }

  const basePacket = {
    schema_version: EVIDENCE_PACKET_SCHEMA_VERSION,
    goal: args.goal,
    sources,
    tool_trace: toolTrace,
    gather_model: args.profile.model_slug,
    synthesis_preview: lastAssistant.slice(0, 4000),
  };
  const packet: EvidencePacket = { ...basePacket, packet_hash: packetHash(basePacket) };

  return {
    packet,
    toolsInvoked,
    finalAssistantText: lastAssistant,
    api_family: args.profile.api_family,
  };
}
