/**
 * Uniform map: catalog handle + function name → connector HTTP execution (no per-vendor gather code).
 * pi_target is a registry key consumed by connectorHttpBackend.
 */

export type ConnectorHttpRegistryEntry = {
  pi_target: string;
  credentialRef: string;
};

const key = (handle: string, functionName: string) => `${handle}::${functionName}`;

const REGISTRY: Record<string, ConnectorHttpRegistryEntry> = {
  [key('plugin:tavily_search', 'tavily_search')]: {
    pi_target: 'tavily:search',
    credentialRef: 'vendor:tavily',
  },
  [key('plugin:tavily_search', 'tavily_extract')]: {
    pi_target: 'tavily:extract',
    credentialRef: 'vendor:tavily',
  },
};

export function lookupConnectorHttp(handle: string, functionName: string): ConnectorHttpRegistryEntry | null {
  return REGISTRY[key(handle, functionName)] ?? null;
}
