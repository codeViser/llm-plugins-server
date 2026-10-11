import { createHash } from 'crypto';

import { clients } from '@/mcp/mcp';
import { listMcpFunctionTools } from '@/multiAgent/toolBridge';

export async function piToolsHash(allow?: string[], deny?: string[]): Promise<string> {
  const tools = await listMcpFunctionTools(clients, { allow, deny });
  const names = tools.map((t) => t.name).sort();
  return createHash('sha256').update(JSON.stringify(names)).digest('hex').slice(0, 16);
}

export function toolsParityReport(args: {
  tm_fingerprint?: string;
  tm_enabled_plugin_count?: number;
  pi_tools_hash: string;
  pi_tool_count: number;
}): { ok: boolean; explain: string } {
  const parts = [
    `pi_tools_hash=${args.pi_tools_hash}`,
    `pi_tool_count=${args.pi_tool_count}`,
    args.tm_fingerprint ? `tm_plugin_fingerprint=${args.tm_fingerprint}` : 'tm_plugin_fingerprint=missing',
    args.tm_enabled_plugin_count != null ? `tm_enabled_plugins=${args.tm_enabled_plugin_count}` : '',
  ].filter(Boolean);
  return {
    ok: true,
    explain:
      'Pi exposes MCP+proxy tools only; TM browser-only plugins are not replayed on Pi. ' + parts.join('; '),
  };
}
