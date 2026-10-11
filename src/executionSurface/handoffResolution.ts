import { lookupConnectorHttp } from './connectorHttpRegistry';
import { buildPiMcpToolIndex, resolveToolRoute } from './routeResolution';
import type { ToolCatalogEntryV1, ToolCatalogV1 } from './types';

export type HandoffRelayMode = 'none' | 'optional' | 'required';

export type ExecutionRoute = 'pi_mcp' | 'pi_connector_http' | 'client' | 'unavailable';

export type ExecutionResolutionEntry = {
  handle: string;
  function_name: string;
  route: ExecutionRoute;
  pi_target: string;
};

export type HandoffExecutionReport = {
  execution_resolution: ExecutionResolutionEntry[];
  degraded_tools: ExecutionResolutionEntry[];
  relay_required: boolean;
  counts: { pi_mcp: number; pi_connector_http: number; client: number; unavailable: number };
};

export function buildHandoffExecutionReport(args: {
  catalog: ToolCatalogV1;
  piListed: Array<{ clientId: string; toolName: string }>;
  piClientIds: Set<string>;
  relayMode: HandoffRelayMode;
}): HandoffExecutionReport {
  const piIndex = buildPiMcpToolIndex(args.piListed);
  const execution_resolution: ExecutionResolutionEntry[] = [];
  const degraded_tools: ExecutionResolutionEntry[] = [];
  const counts = { pi_mcp: 0, pi_connector_http: 0, client: 0, unavailable: 0 };

  for (const entry of args.catalog.tools) {
    const mcpRoute = resolveToolRoute(entry, piIndex, args.piClientIds);
    let route: ExecutionRoute;
    let pi_target = '';

    if (mcpRoute.route === 'pi_mcp' && mcpRoute.mcp) {
      route = 'pi_mcp';
      pi_target = `mcp:${mcpRoute.mcp.clientId}#${mcpRoute.mcp.toolName}`;
    } else {
      const http =
        args.relayMode === 'none' ? lookupConnectorHttp(entry.handle, entry.function.name) : null;
      if (http) {
        route = 'pi_connector_http';
        pi_target = http.pi_target;
      } else if (args.relayMode === 'none') {
        route = 'unavailable';
        pi_target = '';
        degraded_tools.push({
          handle: entry.handle,
          function_name: entry.function.name,
          route,
          pi_target,
        });
      } else {
        route = 'client';
        pi_target = entry.handle;
      }
    }

    counts[route]++;
    execution_resolution.push({
      handle: entry.handle,
      function_name: entry.function.name,
      route,
      pi_target,
    });
  }

  const relay_required = counts.client > 0 && args.relayMode !== 'none';

  return {
    execution_resolution,
    degraded_tools,
    relay_required,
    counts,
  };
}

export function credentialRefsFromResolution(
  report: HandoffExecutionReport
): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const row of report.execution_resolution) {
    if (row.route !== 'pi_connector_http') continue;
    const http = lookupConnectorHttp(row.handle, row.function_name);
    if (http) {
      refs[row.handle] = `stash:${http.credentialRef}`;
    }
  }
  return refs;
}
