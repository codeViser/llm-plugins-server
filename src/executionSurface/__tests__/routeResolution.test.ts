import { describe, expect, it } from 'vitest';

import { buildPiMcpToolIndex, resolveCatalogTools, resolveToolRoute } from '../routeResolution';

describe('routeResolution', () => {
  const piIndex = buildPiMcpToolIndex([
    { clientId: 'search::playwright', toolName: 'navigate' },
  ]);
  const piClients = new Set(['search::playwright', 'store::memory']);

  it('routes to pi_mcp when tool exists on connector', () => {
    const entry = {
      handle: 'mcp:search::playwright',
      function: { name: 'navigate', description: 'go', parameters: { type: 'object', properties: {} } },
    };
    expect(resolveToolRoute(entry, piIndex, piClients).route).toBe('pi_mcp');
  });

  it('routes to client for plugins and missing pi tools', () => {
    const plugin = {
      handle: 'plugin:tavily_search',
      function: { name: 'tavily_search', description: 's', parameters: { type: 'object', properties: {} } },
    };
    expect(resolveToolRoute(plugin, piIndex, piClients).route).toBe('client');

    const macMcp = {
      handle: 'mcp:auto::mac-terminal',
      function: { name: 'run', description: 't', parameters: { type: 'object', properties: {} } },
    };
    expect(resolveToolRoute(macMcp, piIndex, piClients).route).toBe('client');
  });

  it('resolveCatalogTools assigns encoded names', () => {
    const resolved = resolveCatalogTools(
      [
        {
          handle: 'mcp:search::playwright',
          function: { name: 'navigate', description: 'd', parameters: { type: 'object', properties: {} } },
        },
        {
          handle: 'plugin:tavily_search',
          function: { name: 'tavily_search', description: 'd', parameters: { type: 'object', properties: {} } },
        },
      ],
      piIndex,
      piClients
    );
    expect(resolved[0].route).toBe('pi_mcp');
    expect(resolved[0].encodedName).toContain('mcp__');
    expect(resolved[1].route).toBe('client');
    expect(resolved[1].encodedName.startsWith('tm__')).toBe(true);
  });
});
