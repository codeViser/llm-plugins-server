import { createHash } from 'crypto';

import { clients } from '@/mcp/mcp';
import { listMcpFunctionTools } from '@/multiAgent/toolBridge';

import type { TmExecutionContext } from './mcpAllow';

export async function piToolsHash(allow?: string[], deny?: string[]): Promise<string> {
  const tools = await listMcpFunctionTools(clients, { allow, deny });
  const names = tools.map((t) => t.name).sort();
  return createHash('sha256').update(JSON.stringify(names)).digest('hex').slice(0, 16);
}

export function toolsParityReport(args: {
  tm_fingerprint?: string;
  tm_enabled_plugin_count?: number;
  tm_execution_context?: TmExecutionContext | null;
  pi_tools_hash: string;
  pi_tool_count: number;
  mcp_missing_on_pi?: string[];
  parity_strict?: boolean;
}): { ok: boolean; explain: string; warnings: string[] } {
  const warnings: string[] = [];
  if (args.mcp_missing_on_pi && args.mcp_missing_on_pi.length > 0) {
    warnings.push(`TM MCP servers not connected on Pi: ${args.mcp_missing_on_pi.join(', ')}`);
  }
  warnings.push(
    'Browser-only TM plugins (direct vendor JS) are not replayed on Pi; use MCP on the connector or context_packet.'
  );
  if (args.tm_enabled_plugin_count != null && args.pi_tool_count === 0) {
    warnings.push('Pi returned zero MCP tools for this allowlist; gather may run without tools.');
  }
  const parts = [
    `pi_tools_hash=${args.pi_tools_hash}`,
    `pi_tool_count=${args.pi_tool_count}`,
    args.tm_fingerprint ? `tm_plugin_fingerprint=${args.tm_fingerprint}` : 'tm_plugin_fingerprint=missing',
    args.tm_enabled_plugin_count != null ? `tm_enabled_plugins=${args.tm_enabled_plugin_count}` : '',
    args.tm_execution_context?.context_hash
      ? `tm_context_hash=${args.tm_execution_context.context_hash}`
      : '',
    args.tm_execution_context?.mcp_server_ids?.length
      ? `tm_mcp_servers=${args.tm_execution_context.mcp_server_ids.length}`
      : '',
  ].filter(Boolean);
  const ok =
    !args.parity_strict || !args.mcp_missing_on_pi || args.mcp_missing_on_pi.length === 0;
  return {
    ok,
    explain: parts.join('; '),
    warnings,
  };
}
