import { z } from 'zod';

const functionSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  parameters: z.record(z.unknown()),
});

export const ToolCatalogEntryV1Schema = z.object({
  handle: z.string().min(1),
  function: functionSchema,
});

export const ToolCatalogV1Schema = z.object({
  schema_version: z.literal(1),
  catalog_hash: z.string().min(1),
  tools: z.array(ToolCatalogEntryV1Schema),
});

export const ToolRelayRegisterSchema = z.object({
  type: z.literal('register'),
  job_id: z.string().min(1),
  catalog_hash: z.string().min(1),
  mcp_auth_token: z.string().min(1),
});

export const ToolRelayInvokeSchema = z.object({
  type: z.literal('invoke'),
  call_id: z.string().min(1),
  job_id: z.string().min(1),
  handle: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.unknown()).optional(),
});

export const ToolRelayResultSchema = z.object({
  type: z.literal('result'),
  call_id: z.string().min(1),
  job_id: z.string().min(1),
  content: z.string(),
  is_error: z.boolean().optional(),
});

export const ToolRelayHeartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  job_id: z.string().min(1),
});

export const ToolRelayMessageSchema = z.discriminatedUnion('type', [
  ToolRelayRegisterSchema,
  ToolRelayInvokeSchema,
  ToolRelayResultSchema,
  ToolRelayHeartbeatSchema,
]);
