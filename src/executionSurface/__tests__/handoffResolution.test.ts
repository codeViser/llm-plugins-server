import { describe, expect, it } from 'vitest';

import { computeCatalogHash } from '../catalogHash';
import { buildHandoffExecutionReport } from '../handoffResolution';
import { buildPiMcpToolIndex } from '../routeResolution';

describe('handoffResolution', () => {
  const piIndex = buildPiMcpToolIndex([{ clientId: 'search::playwright', toolName: 'navigate' }]);
  const piListed = [{ clientId: 'search::playwright', toolName: 'navigate' }];
  const piClients = new Set(['search::playwright']);

  it('maps tavily to pi_connector_http when relay_mode none', () => {
    const tools = [
      {
        handle: 'plugin:tavily_search',
        function: {
          name: 'tavily_search',
          description: 'search',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      },
    ];
    const catalog = {
      schema_version: 1 as const,
      catalog_hash: computeCatalogHash(tools),
      tools,
    };
    const report = buildHandoffExecutionReport({
      catalog,
      piListed,
      piClientIds: piClients,
      relayMode: 'none',
    });
    expect(report.counts.pi_connector_http).toBe(1);
    expect(report.degraded_tools).toHaveLength(0);
    expect(report.relay_required).toBe(false);
  });

  it('marks mac mcp unavailable under relay_mode none', () => {
    const tools = [
      {
        handle: 'mcp:auto::mac-terminal',
        function: {
          name: 'run',
          description: 'shell',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
    const catalog = {
      schema_version: 1 as const,
      catalog_hash: computeCatalogHash(tools),
      tools,
    };
    const report = buildHandoffExecutionReport({
      catalog,
      piListed,
      piClientIds: piClients,
      relayMode: 'none',
    });
    expect(report.degraded_tools).toHaveLength(1);
    expect(report.degraded_tools[0].route).toBe('unavailable');
  });
});
