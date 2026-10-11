import { encodeMcpToolName } from '@/multiAgent/toolBridge';

import type { ExecutionResolutionEntry } from './handoffResolution';
import { encodeTmToolName } from './toolNameCodec';
import type { ResolvedToolDescriptor, ToolCatalogEntryV1, ToolCatalogV1 } from './types';

export function resolvedDescriptorsFromHandoff(
  catalog: ToolCatalogV1,
  plan: ExecutionResolutionEntry[]
): ResolvedToolDescriptor[] {
  const planByKey = new Map(plan.map((row) => [`${row.handle}::${row.function_name}`, row]));
  const out: ResolvedToolDescriptor[] = [];

  for (const entry of catalog.tools) {
    const row = planByKey.get(`${entry.handle}::${entry.function.name}`);
    if (!row || row.route === 'unavailable') {
      continue;
    }
    const route = row.route;
    let encodedName: string;
    let mcp: ResolvedToolDescriptor['mcp'];

    if (route === 'pi_mcp' && row.pi_target.startsWith('mcp:')) {
      const rest = row.pi_target.slice(4);
      const hash = rest.indexOf('#');
      const clientId = hash >= 0 ? rest.slice(0, hash) : rest;
      const toolName = hash >= 0 ? rest.slice(hash + 1) : entry.function.name;
      encodedName = encodeMcpToolName(clientId, toolName);
      mcp = { clientId, toolName };
    } else {
      encodedName = encodeTmToolName(entry.handle, entry.function.name);
    }

    out.push({
      handle: entry.handle,
      route,
      encodedName,
      function: entry.function,
      mcp,
      pi_target: row.pi_target,
    });
  }

  return out;
}

export function mergeLegacyResolved(
  handoff: ResolvedToolDescriptor[],
  extras: ResolvedToolDescriptor[]
): ResolvedToolDescriptor[] {
  const seen = new Set(handoff.map((r) => r.encodedName));
  const merged = [...handoff];
  for (const e of extras) {
    if (!seen.has(e.encodedName)) {
      seen.add(e.encodedName);
      merged.push(e);
    }
  }
  return merged;
}
