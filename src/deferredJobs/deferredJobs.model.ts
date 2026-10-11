import { z } from 'zod';

import { parsePositiveInt } from '@/multiAgent/maxAgents';

import { ToolCatalogV1Schema } from '@/executionSurface/toolCatalog.schema';

import { InferenceProfileV2Schema } from './inferenceProfile';
import { DeferredProgressSchema } from './schemas';
import { optionalRecord } from './zodHelpers';

const optionalPositiveInt = z.preprocess((value) => parsePositiveInt(value), z.number().int().positive().optional());

const optionalTrueFlag = z.preprocess((value) => {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  return undefined;
}, z.literal(true).optional());

export const DeferredRunRequestSchema = z.object({
  goal: z.string().min(1),
  context_packet: z.union([z.string(), z.record(z.unknown()), z.null()]).optional(),
  mcp_auth_token: z.string().optional(),
  openai_api_key: z.string().optional(),
  openrouter_api_key: z.string().optional(),
  gather_model: z.string().min(1).optional(),
  gather_provider: z.enum(['openai', 'openrouter']).optional(),
  gather_reasoning_effort: z.string().min(1).optional(),
  think_model: z.string().optional(),
  think_reasoning_effort: z.string().min(1).optional(),
  allow_mcp_clients: z.array(z.string()).optional(),
  deny_mcp_clients: z.array(z.string()).optional(),
  max_gather_turns: optionalPositiveInt,
  max_tool_calls: optionalPositiveInt,
  max_refine_rounds: optionalPositiveInt,
  skip_batch: optionalTrueFlag,
  async: optionalTrueFlag,
  dry_run: optionalTrueFlag,
  gather_profile: InferenceProfileV2Schema,
  think_profile: InferenceProfileV2Schema.optional(),
  tm_enabled_plugin_count: z.number().int().optional(),
  tm_execution_context: z
    .object({
      mcp_server_ids: z.array(z.string()).optional(),
      enabled_plugin_ids: z.array(z.string()).optional(),
      chat_wire: optionalRecord,
    })
    .optional(),
  parity_strict: optionalTrueFlag,
  tool_catalog_v1: ToolCatalogV1Schema.optional(),
  relay_mode: z.enum(['optional', 'required']).optional(),
});

export type DeferredRunRequest = z.infer<typeof DeferredRunRequestSchema>;

export type DeferredRunInput = DeferredRunRequest & {
  context_packet?: string;
  progress?: z.infer<typeof DeferredProgressSchema>;
};

export const DeferredPollRequestSchema = z.object({
  job_id: z.string().min(1),
});

export function contextPacketToString(value: DeferredRunRequest['context_packet']): string {
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
