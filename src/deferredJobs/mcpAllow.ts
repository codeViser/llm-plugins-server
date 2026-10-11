export type TmExecutionContext = {
  mcp_server_ids?: string[];
  enabled_plugin_ids?: string[];
  context_hash?: string;
};

export function resolveMcpAllowList(args: {
  piClientIds: string[];
  tmContext?: TmExecutionContext | null;
  explicitAllow?: string[];
}): { allow: string[] | undefined; missingOnPi: string[] } {
  if (args.explicitAllow && args.explicitAllow.length > 0) {
    const missing = args.explicitAllow.filter((id) => !args.piClientIds.includes(id));
    return { allow: args.explicitAllow, missingOnPi: missing };
  }
  const tmIds = args.tmContext?.mcp_server_ids ?? [];
  if (!tmIds.length) {
    return { allow: undefined, missingOnPi: [] };
  }
  const piSet = new Set(args.piClientIds);
  const allow = tmIds.filter((id) => piSet.has(id));
  const missingOnPi = tmIds.filter((id) => !piSet.has(id));
  return { allow: allow.length ? allow : undefined, missingOnPi };
}
