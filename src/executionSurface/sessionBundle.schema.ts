import { z } from 'zod';

import { ToolCatalogV1Schema } from './toolCatalog.schema';

export const HandoffRelayModeSchema = z.enum(['none', 'optional', 'required']);

export const ExecutionResolutionEntrySchema = z.object({
  handle: z.string().min(1),
  function_name: z.string().min(1),
  route: z.enum(['pi_mcp', 'pi_connector_http', 'client', 'unavailable']),
  pi_target: z.string(),
});

export const SessionBundleV1Schema = z.object({
  schema_version: z.literal(1),
  relay_mode: HandoffRelayModeSchema,
  tool_catalog_v1: ToolCatalogV1Schema,
  execution_resolution: z.array(ExecutionResolutionEntrySchema).optional(),
  credential_refs: z.record(z.string()).optional(),
  skill_payloads: z
    .array(
      z.object({
        skill_id: z.string(),
        markdown_hash: z.string().optional(),
        body: z.string(),
      })
    )
    .optional(),
});

export type SessionBundleV1 = z.infer<typeof SessionBundleV1Schema>;
