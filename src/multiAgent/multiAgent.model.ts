import { z } from 'zod';

import { ToolCatalogV1Schema } from '@/executionSurface/toolCatalog.schema';

import { parsePositiveInt } from './maxAgents';

function blankToUndefined(value: unknown): unknown {
  if (value === '' || value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    if (!trimmed || lower === 'null' || lower === 'undefined') {
      return undefined;
    }
    if (/^\{[A-Za-z0-9_]+\}$/.test(trimmed)) {
      return undefined;
    }
  }
  return value;
}

/**
 * TypingMind HTTP Actions substitute placeholders as strings, JSON null, or
 * the word "null". z.coerce.number() turns those into NaN and 400s the request.
 */
const optionalPositiveInt = z.preprocess((value) => parsePositiveInt(value), z.number().int().positive().optional());

const optionalNonEmptyString = z.preprocess(blankToUndefined, z.string().min(1).optional());

const optionalTrueFlag = z.preprocess((value) => {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  return undefined;
}, z.literal(true).optional());

export const MultiAgentRunRequestSchema = z.object({
  goal: z.string().min(1),
  context_packet: z.union([z.string(), z.record(z.unknown()), z.null()]).optional(),
  max_agents: optionalPositiveInt,
  requested_agents: optionalPositiveInt,
  model: optionalNonEmptyString,
  openai_api_key: optionalNonEmptyString,
  mcp_auth_token: optionalNonEmptyString,
  timeout_sec: optionalPositiveInt,
  allow_mcp_clients: z.array(z.string()).optional(),
  deny_mcp_clients: z.array(z.string()).optional(),
  dry_run: optionalTrueFlag,
  // When true, the run is started in the background and a job_id is returned
  // immediately. The client polls /poll for the result, keeping every request
  // short (Cloudflare/tunnel drop long-held connections).
  async: optionalTrueFlag,
  tool_catalog_v1: ToolCatalogV1Schema.optional(),
});

export type MultiAgentRunRequest = z.infer<typeof MultiAgentRunRequestSchema>;

export const MultiAgentPollRequestSchema = z.object({
  job_id: z.preprocess(blankToUndefined, z.string().min(1)),
});

export function contextPacketToString(value: MultiAgentRunRequest['context_packet']): string {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}
