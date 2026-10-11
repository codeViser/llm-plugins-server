import { z } from 'zod';

export const EVIDENCE_PACKET_SCHEMA_VERSION = 1;
export const EVIDENCE_REQUESTS_SCHEMA_VERSION = 1;

export const OrchestratorPhaseSchema = z.enum([
  'gathering',
  'batch_submitted',
  'batch_polling',
  'refining',
  'done',
  'failed',
]);

export const EvidenceSourceSchema = z.object({
  title: z.string().optional(),
  snippet: z.string(),
  tool: z.string().optional(),
});

export const ToolTraceEntrySchema = z.object({
  tool: z.string(),
  ok: z.boolean(),
  chars: z.number().optional(),
});

export const EvidencePacketSchema = z.object({
  schema_version: z.literal(EVIDENCE_PACKET_SCHEMA_VERSION),
  goal: z.string(),
  sources: z.array(EvidenceSourceSchema),
  tool_trace: z.array(ToolTraceEntrySchema),
  gather_model: z.string(),
  synthesis_preview: z.string().optional(),
  packet_hash: z.string().optional(),
});

export const EvidenceRequestSchema = z.object({
  id: z.string(),
  intent: z.string(),
  tool_hints: z.array(z.string()).optional(),
  constraints: z.string().optional(),
});

export const EvidenceRequestsSchema = z.object({
  schema_version: z.literal(EVIDENCE_REQUESTS_SCHEMA_VERSION),
  requests: z.array(EvidenceRequestSchema),
});

export const DeferredProgressSchema = z.object({
  phase: OrchestratorPhaseSchema,
  updated_at: z.string(),
  or_batch_id: z.string().optional(),
  or_batch_status: z.string().optional(),
  gather_rounds: z.number().optional(),
  message: z.string().optional(),
});

export type EvidencePacket = z.infer<typeof EvidencePacketSchema>;
export type EvidenceRequest = z.infer<typeof EvidenceRequestSchema>;
export type DeferredProgress = z.infer<typeof DeferredProgressSchema>;
export type OrchestratorPhase = z.infer<typeof OrchestratorPhaseSchema>;
