import {
  decodeMcpToolName,
  executeMcpFunctionCall,
  listMcpFunctionTools,
  type McpListableClient,
  type OpenAIFunctionTool,
} from '@/multiAgent/toolBridge';
import { RESEARCH_COUNCIL_CLIENT_ID } from '@/multiAgent/researchCouncilId';

async function mcpClients(): Promise<Map<string, { id: string; client: McpListableClient }>> {
  const { clients } = await import('@/mcp/mcp');
  return clients;
}

import { executeClientRelayTool } from './clientRelayBackend';
import { buildPiMcpToolIndex, resolveCatalogTools } from './routeResolution';
import type { JobToolRouter, ResolvedToolDescriptor, ToolCatalogV1, ToolExecuteResult } from './types';

export type BuildJobToolRouterArgs = {
  catalog?: ToolCatalogV1 | null;
  allowMcpClients?: string[];
  denyMcpClients?: string[];
  jobId?: string;
  relayTimeoutMs?: number;
};

async function listPiMcpRows(allow?: string[], deny?: string[]): Promise<Array<{ clientId: string; toolName: string }>> {
  const tools = await listMcpFunctionTools(await mcpClients(), { allow, deny });
  const rows: Array<{ clientId: string; toolName: string }> = [];
  for (const t of tools) {
    const decoded = decodeMcpToolName(t.name);
    if (decoded) rows.push({ clientId: decoded.clientId, toolName: decoded.toolName });
  }
  return rows;
}

async function piClientIdSet(): Promise<Set<string>> {
  const clientMap = await mcpClients();
  return new Set([...clientMap.keys()].filter((id) => id !== RESEARCH_COUNCIL_CLIENT_ID));
}

export async function buildJobToolRouter(args: BuildJobToolRouterArgs): Promise<JobToolRouter> {
  const allow = args.allowMcpClients;
  const deny = args.denyMcpClients;

  if (!args.catalog?.tools?.length) {
    const clientMap = await mcpClients();
    const legacy = await listMcpFunctionTools(clientMap, { allow, deny });
    return {
      summary: () => ({ pi_mcp: legacy.length, client: 0, legacy_mcp_only: true }),
      listOpenAIFunctionTools: async () => legacy,
      execute: async (encodedName, rawArguments) =>
        executeMcpFunctionCall(await mcpClients(), encodedName, rawArguments),
    };
  }

  const piRows = await listPiMcpRows(allow, deny);
  const piIndex = buildPiMcpToolIndex(piRows);
  const resolved = resolveCatalogTools(args.catalog.tools, piIndex, await piClientIdSet());
  const resolvedByEncoded = new Map<string, ResolvedToolDescriptor>();
  for (const r of resolved) {
    resolvedByEncoded.set(r.encodedName, r);
  }

  const encodedSeen = new Set(resolved.map((r) => r.encodedName));
  const clientMap = await mcpClients();
  const piExtras = await listMcpFunctionTools(clientMap, { allow, deny });
  for (const t of piExtras) {
    if (!encodedSeen.has(t.name)) {
      encodedSeen.add(t.name);
      resolved.push({
        handle: `mcp:${decodeMcpToolName(t.name)?.clientId ?? 'unknown'}`,
        route: 'pi_mcp',
        encodedName: t.name,
        function: {
          name: decodeMcpToolName(t.name)?.toolName ?? t.name,
          description: t.description,
          parameters: t.parameters,
        },
        mcp: decodeMcpToolName(t.name) || undefined,
      });
      resolvedByEncoded.set(t.name, resolved[resolved.length - 1]!);
    }
  }

  const openAiTools: OpenAIFunctionTool[] = resolved.map((r) => ({
    type: 'function',
    name: r.encodedName,
    description: r.route === 'pi_mcp' ? `[MCP] ${r.function.description}` : `[TM] ${r.function.description}`,
    parameters: r.function.parameters,
  }));

  const relayOpts = {
    jobId: args.jobId ?? '',
    catalogHash: args.catalog.catalog_hash,
    resolvedByEncoded,
    timeoutMs: args.relayTimeoutMs,
  };

  return {
    summary: () => {
      const counts = { pi_mcp: 0, client: 0 };
      for (const r of resolved) {
        counts[r.route]++;
      }
      return counts;
    },
    listOpenAIFunctionTools: async () => openAiTools,
    execute: async (encodedName, rawArguments): Promise<ToolExecuteResult> => {
      const descriptor = resolvedByEncoded.get(encodedName);
      if (!descriptor) {
        if (decodeMcpToolName(encodedName)) {
          return executeMcpFunctionCall(await mcpClients(), encodedName, rawArguments);
        }
        return { ok: false, text: `Unknown tool: ${encodedName}` };
      }
      if (descriptor.route === 'pi_mcp') {
        return executeMcpFunctionCall(await mcpClients(), encodedName, rawArguments);
      }
      if (!args.jobId) {
        return { ok: false, text: 'Client relay tool requires job_id' };
      }
      return executeClientRelayTool(relayOpts, encodedName, rawArguments);
    },
  };
}

export type ToolCatalogResolved = {
  catalog_hash: string;
  pi_mcp: number;
  client: number;
  relay_required: boolean;
  total: number;
};

export async function resolveToolCatalogForDryRun(
  catalog: ToolCatalogV1,
  allowMcpClients?: string[],
  denyMcpClients?: string[]
): Promise<ToolCatalogResolved> {
  const piRows = await listPiMcpRows(allowMcpClients, denyMcpClients);
  const piIndex = buildPiMcpToolIndex(piRows);
  const resolved = resolveCatalogTools(catalog.tools, piIndex, await piClientIdSet());
  const counts = { pi_mcp: 0, client: 0 };
  for (const r of resolved) {
    counts[r.route]++;
  }
  return {
    catalog_hash: catalog.catalog_hash,
    ...counts,
    total: resolved.length,
    relay_required: counts.client > 0,
  };
}
