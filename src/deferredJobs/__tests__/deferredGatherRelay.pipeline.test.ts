import { beforeEach, describe, expect, it, vi } from 'vitest';

import { computeCatalogHash } from '@/executionSurface/catalogHash';
import * as relaySession from '@/executionSurface/relaySession';

import { runGatherAgent } from '../gatherAgent';

const gotPost = vi.hoisted(() => vi.fn());

vi.mock('got', () => ({
  default: {
    post: gotPost,
  },
}));

describe('deferred gather with client relay catalog', () => {
  beforeEach(() => {
    gotPost.mockReset();
    vi.spyOn(relaySession, 'invokeClientTool').mockResolvedValue({ ok: true, text: 'tavily-results' });
    relaySession.registerRelaySession({
      jobId: 'relay-job',
      catalogHash: 'will-set',
    });
  });

  it('invokes relay when model requests client tool', async () => {
    const tools = [
      {
        handle: 'plugin:tavily_search',
        function: {
          name: 'tavily_search',
          description: 'search web',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      },
    ];
    const catalog_hash = computeCatalogHash(tools);
    relaySession.registerRelaySession({
      jobId: 'relay-job',
      catalogHash: catalog_hash,
    });

    gotPost.mockResolvedValueOnce({
      body: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'tc1',
                  function: {
                    name: 'ma_0',
                    arguments: JSON.stringify({ query: 'deferred relay test' }),
                  },
                },
              ],
            },
          },
        ],
      },
    });
    gotPost.mockResolvedValueOnce({
      body: {
        choices: [{ message: { role: 'assistant', content: 'Summary with evidence.' } }],
      },
    });

    const result = await runGatherAgent({
      goal: 'test relay gather',
      gatherModel: 'openai/gpt-6-luna',
      gatherProvider: 'openrouter',
      openrouterApiKey: 'sk-test',
      maxTurns: 4,
      maxToolCalls: 2,
      toolCatalog: { schema_version: 1, catalog_hash, tools },
      jobId: 'relay-job',
    });

    expect(result.toolsInvoked.length).toBeGreaterThan(0);
    expect(result.packet.tool_trace.some((t) => t.ok)).toBe(true);
    expect(relaySession.invokeClientTool).toHaveBeenCalled();
  });
});
