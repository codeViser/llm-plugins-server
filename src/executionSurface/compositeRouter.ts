import {
  decodeMcpToolName,
  executeMcpFunctionCall,
  listMcpFunctionTools,
  type McpListableClient,
  type OpenAIFunctionTool,
} from '@/multiAgent/toolBridge';
import { RESEARCH_COUNCIL_CLIENT_ID } from '@/multiAgent/researchCouncilId';

import { getDeferredRunSecrets } from '@/deferredJobs/runSecrets';

import { executeClientRelayTool } from './clientRelayBackend';
import { executeConnectorHttpTool } from './connectorHttpBackend';
import { mergeLegacyResolved, resolvedDescriptorsFromHandoff } from './handoffDescriptors';
import type { ExecutionResolutionEntry, HandoffRelayMode } from './handoffResolution';
import { buildHandoffExecutionReport } from './handoffResolution';
import { buildPiMcpToolIndex, resolveCatalogTools } from './routeResolution';
import type { JobToolRouter, ResolvedToolDescriptor, ToolCatalogV1, ToolExecuteResult } from './types';

async function mcpClients(): Promise<Map<string, { id: string; client: McpListableClient }>> {
  const { clients } = await import('@/mcp/mcp');
  return clients;
}

export type BuildJobToolRouterArgs = {
  catalog?: ToolCatalogV1 | null;
  allowMcpClients?: string[];
  denyMcpClients?: string[];
  jobId?: string;
  relayTimeoutMs?: number;
  executionResolution?: ExecutionResolutionEntry[];
  relayMode?: HandoffRelayMode;
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

function routeTag(route: ResolvedToolDescriptor['route']): string {
  if (route === 'pi_mcp') return '[MCP]';
  if (route === 'pi_connector_http') return '[Pi]';
  return '[TM]';
}

function summarizeResolved(resolved: ResolvedToolDescriptor[]) {
  const counts = { pi_mcp: 0, pi_connector_http: 0, client: 0 };
  for (const r of resolved) {
    if (r.route === 'pi_mcp') counts.pi_mcp++;
    else if (r.route === 'pi_connector_http') counts.pi_connector_http++;
    else counts.client++;
  }
  return counts;
}

export async function buildJobToolRouter(args: BuildJobToolRouterArgs): Promise<JobToolRouter> {
  const allow = args.allowMcpClients;
  const deny = args.denyMcpClients;

  if (!args.catalog?.tools?.length) {
    const clientMap = await mcpClients();
    const legacy = await listMcpFunctionTools(clientMap, { allow, deny });
    return {
      summary: () => ({ pi_mcp: legacy.length, pi_connector_http: 0, client: 0, legacy_mcp_only: true }),
      listOpenAIFunctionTools: async () => legacy,
      execute: async (encodedName, rawArguments) =>
        executeMcpFunctionCall(await mcpClients(), encodedName, rawArguments),
    };
  }

  const piRows = await listPiMcpRows(allow, deny);
  const piIndex = buildPiMcpToolIndex(piRows);
  const piClients = await piClientIdSet();

  const relayMode = args.relayMode ?? 'optional';
  const plan =
    args.executionResolution ??
    buildHandoffExecutionReport({
      catalog: args.catalog,
      piListed: piRows,
      piClientIds: piClients,
      relayMode,
    }).execution_resolution;

  let resolved = resolvedDescriptorsFromHandoff(args.catalog, plan);

  const legacyResolved = resolveCatalogTools(args.catalog.tools, piIndex, piClients);
  const encodedSeen = new Set(resolved.map((r) => r.encodedName));
  const clientMap = await mcpClients();
  const piExtras = await listMcpFunctionTools(clientMap, { allow, deny });
  const extraDescriptors: ResolvedToolDescriptor[] = [];
  for (const t of piExtras) {
    if (!encodedSeen.has(t.name)) {
      encodedSeen.add(t.name);
      extraDescriptors.push({
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
    }
  }
  resolved = mergeLegacyResolved(resolved, extraDescriptors);

  const resolvedByEncoded = new Map<string, ResolvedToolDescriptor>();
  for (const r of resolved) {
    resolvedByEncoded.set(r.encodedName, r);
  }

  const openAiTools: OpenAIFunctionTool[] = resolved.map((r) => ({
    type: 'function',
    name: r.encodedName,
    description: `${routeTag(r.route)} ${r.function.description}`,
    parameters: r.function.parameters,
  }));

  const relayOpts = {
    jobId: args.jobId ?? '',
    catalogHash: args.catalog.catalog_hash,
    resolvedByEncoded,
    timeoutMs: args.relayTimeoutMs,
  };

  return {
    summary: () => summarizeResolved(resolved),
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
      if (descriptor.route === 'pi_connector_http') {
        const vendor = args.jobId ? getDeferredRunSecrets(args.jobId)?.vendor ?? {} : {};
        return executeConnectorHttpTool({
          piTarget: descriptor.pi_target ?? '',
          functionName: descriptor.function.name,
          rawArguments,
          credentials: vendor,
          credentialHandle: descriptor.handle,
        });
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
  pi_connector_http: number;
  client: number;
  relay_required: boolean;
  total: number;
  execution_resolution?: ExecutionResolutionEntry[];
  degraded_tools?: ExecutionResolutionEntry[];
};

export async function resolveToolCatalogForDryRun(
  catalog: ToolCatalogV1,
  allowMcpClients?: string[],
  denyMcpClients?: string[],
  relayMode: HandoffRelayMode = 'optional'
): Promise<ToolCatalogResolved> {
  const piRows = await listPiMcpRows(allowMcpClients, denyMcpClients);
  const handoff = buildHandoffExecutionReport({
    catalog,
    piListed: piRows,
    piClientIds: await piClientIdSet(),
    relayMode,
  });
  return {
    catalog_hash: catalog.catalog_hash,
    pi_mcp: handoff.counts.pi_mcp,
    pi_connector_http: handoff.counts.pi_connector_http,
    client: handoff.counts.client,
    total: catalog.tools.length,
    relay_required: handoff.relay_required,
    execution_resolution: handoff.execution_resolution,
    degraded_tools: handoff.degraded_tools,
  };
}
