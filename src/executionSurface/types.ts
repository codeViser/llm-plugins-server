import type { OpenAIFunctionTool } from '@/multiAgent/toolBridge';

export type ToolRoute = 'pi_mcp' | 'pi_connector_http' | 'client';

export type ToolCatalogEntryV1 = {
  handle: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCatalogV1 = {
  schema_version: 1;
  catalog_hash: string;
  tools: ToolCatalogEntryV1[];
};

export type ResolvedToolDescriptor = {
  handle: string;
  route: ToolRoute;
  encodedName: string;
  function: ToolCatalogEntryV1['function'];
  mcp?: { clientId: string; toolName: string };
  pi_target?: string;
};

export type ToolExecuteResult = { ok: true; text: string } | { ok: false; text: string };

export type JobToolRouter = {
  listOpenAIFunctionTools: () => Promise<OpenAIFunctionTool[]>;
  execute: (encodedName: string, rawArguments: string | Record<string, unknown> | undefined) => Promise<ToolExecuteResult>;
  summary: () => {
    pi_mcp: number;
    pi_connector_http: number;
    client: number;
    legacy_mcp_only?: boolean;
  };
};

export type PiMcpToolIndex = Map<string, Set<string>>;
