import { z } from 'zod';

import { parsePositiveInt } from '@/multiAgent/maxAgents';

import { DeferredProgressSchema } from './schemas';

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
  think_model: z.string().optional(),
  allow_mcp_clients: z.array(z.string()).optional(),
  deny_mcp_clients: z.array(z.string()).optional(),
  max_gather_turns: optionalPositiveInt,
  max_tool_calls: optionalPositiveInt,
  max_refine_rounds: optionalPositiveInt,
  skip_batch: optionalTrueFlag,
  async: optionalTrueFlag,
  dry_run: optionalTrueFlag,
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
