import { describe, expect, it, vi } from 'vitest';

import { buildJobToolRouter } from '../compositeRouter';
import { computeCatalogHash } from '../catalogHash';
import * as relaySession from '../relaySession';

describe('compositeRouter', () => {
  it('executes client relay path for client-routed tools', async () => {
    const tools = [
      {
        handle: 'plugin:tavily_search',
        function: {
          name: 'tavily_search',
          description: 'search',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
    const catalog = {
      schema_version: 1 as const,
      catalog_hash: computeCatalogHash(tools),
      tools,
    };

    vi.spyOn(relaySession, 'invokeClientTool').mockResolvedValue({ ok: true, text: 'relay-hit' });
    relaySession.registerRelaySession({
      jobId: 'job-1',
      catalogHash: catalog.catalog_hash,
    });

    const router = await buildJobToolRouter({
      catalog,
      jobId: 'job-1',
    });
    const listed = await router.listOpenAIFunctionTools();
    expect(listed.length).toBe(1);
    const exec = await router.execute(listed[0].name, { query: 'x' });
    expect(exec.ok).toBe(true);
    expect(exec.text).toBe('relay-hit');
  });
});
