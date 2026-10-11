/**
 * Uniform map: catalog handle + function name → connector HTTP execution (no per-vendor gather code).
 * pi_target is a registry key consumed by connectorHttpBackend.
 * Credentials resolve via credentialHandle (plugin:{id}) + TM snapshot vendor map.
 */

export type ConnectorHttpRegistryEntry = {
  pi_target: string;
  /** Plugin handle used with pickCredentialForHandle (e.g. plugin:tavily_search). */
  credentialHandle: string;
};

const key = (handle: string, functionName: string) => `${handle}::${functionName}`;

const REGISTRY: Record<string, ConnectorHttpRegistryEntry> = {
  [key('plugin:tavily_search', 'tavily_search')]: {
    pi_target: 'tavily:search',
    credentialHandle: 'plugin:tavily_search',
  },
  [key('plugin:tavily_search', 'tavily_extract')]: {
    pi_target: 'tavily:extract',
    credentialHandle: 'plugin:tavily_search',
  },
};

export function lookupConnectorHttp(handle: string, functionName: string): ConnectorHttpRegistryEntry | null {
  return REGISTRY[key(handle, functionName)] ?? null;
}
