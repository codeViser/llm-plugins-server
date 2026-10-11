import { decodeTmToolName } from './toolNameCodec';
import { invokeClientTool } from './relaySession';
import type { ResolvedToolDescriptor, ToolExecuteResult } from './types';

export type ClientRelayBackendOptions = {
  jobId: string;
  catalogHash: string;
  resolvedByEncoded: Map<string, ResolvedToolDescriptor>;
  timeoutMs?: number;
};

export async function executeClientRelayTool(
  opts: ClientRelayBackendOptions,
  encodedName: string,
  rawArguments: string | Record<string, unknown> | undefined
): Promise<ToolExecuteResult> {
  const decoded = decodeTmToolName(encodedName);
  if (!decoded) {
    return { ok: false, text: `Unknown client tool encoding: ${encodedName}` };
  }
  const descriptor = opts.resolvedByEncoded.get(encodedName);
  if (!descriptor || descriptor.route !== 'client') {
    return { ok: false, text: `Tool not in client relay catalog: ${encodedName}` };
  }

  let parsed: Record<string, unknown> = {};
  if (typeof rawArguments === 'string' && rawArguments.trim()) {
    try {
      parsed = JSON.parse(rawArguments) as Record<string, unknown>;
    } catch {
      return { ok: false, text: 'Tool arguments were not valid JSON' };
    }
  } else if (rawArguments && typeof rawArguments === 'object') {
    parsed = rawArguments;
  }

  const result = await invokeClientTool({
    jobId: opts.jobId,
    catalogHash: opts.catalogHash,
    handle: decoded.handle,
    name: decoded.functionName,
    arguments: parsed,
    timeoutMs: opts.timeoutMs,
  });
  return result.ok ? { ok: true, text: result.text } : { ok: false, text: result.text };
}
