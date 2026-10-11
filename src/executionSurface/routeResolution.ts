import { encodeMcpToolName } from '@/multiAgent/toolBridge';

import { encodeTmToolName, parseMcpHandle } from './toolNameCodec';
import type { PiMcpToolIndex, ResolvedToolDescriptor, ToolCatalogEntryV1, ToolRoute } from './types';

export function buildPiMcpToolIndex(
  listed: Array<{ clientId: string; toolName: string }>
): PiMcpToolIndex {
  const index: PiMcpToolIndex = new Map();
  for (const row of listed) {
    let set = index.get(row.clientId);
    if (!set) {
      set = new Set();
      index.set(row.clientId, set);
    }
    set.add(row.toolName);
  }
  return index;
}

export function resolveToolRoute(
  entry: ToolCatalogEntryV1,
  piIndex: PiMcpToolIndex,
  piClientIds: Set<string>
): { route: ToolRoute; mcp?: { clientId: string; toolName: string } } {
  const mcpId = parseMcpHandle(entry.handle);
  if (mcpId && piClientIds.has(mcpId)) {
    const names = piIndex.get(mcpId);
    if (names?.has(entry.function.name)) {
      return { route: 'pi_mcp', mcp: { clientId: mcpId, toolName: entry.function.name } };
    }
  }
  return { route: 'client' };
}

export function resolveCatalogTools(
  tools: ToolCatalogEntryV1[],
  piIndex: PiMcpToolIndex,
  piClientIds: Set<string>
): ResolvedToolDescriptor[] {
  return tools.map((entry) => {
    const { route, mcp } = resolveToolRoute(entry, piIndex, piClientIds);
    const encodedName =
      route === 'pi_mcp' && mcp
        ? encodeMcpToolName(mcp.clientId, mcp.toolName)
        : encodeTmToolName(entry.handle, entry.function.name);
    return {
      handle: entry.handle,
      route,
      encodedName,
      function: entry.function,
      mcp,
    };
  });
}

export function countRoutes(resolved: ResolvedToolDescriptor[]): { pi_mcp: number; client: number } {
  let pi_mcp = 0;
  let client = 0;
  for (const r of resolved) {
    if (r.route === 'pi_mcp') pi_mcp++;
    else client++;
  }
  return { pi_mcp, client };
}
