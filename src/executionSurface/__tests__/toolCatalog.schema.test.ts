import { describe, expect, it } from 'vitest';

import { computeCatalogHash, verifyCatalogHash } from '../catalogHash';
import { ToolCatalogV1Schema, ToolRelayMessageSchema } from '../toolCatalog.schema';

describe('tool catalog and relay schemas', () => {
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

  it('validates tool_catalog_v1 with matching hash', () => {
    const hash = computeCatalogHash(tools);
    const parsed = ToolCatalogV1Schema.safeParse({
      schema_version: 1,
      catalog_hash: hash,
      tools,
    });
    expect(parsed.success).toBe(true);
    expect(verifyCatalogHash(parsed.data!)).toBe(true);
  });

  it('rejects hash mismatch', () => {
    const parsed = ToolCatalogV1Schema.safeParse({
      schema_version: 1,
      catalog_hash: 'deadbeef',
      tools,
    });
    expect(parsed.success).toBe(true);
    expect(verifyCatalogHash(parsed.data!)).toBe(false);
  });

  it('validates relay messages', () => {
    expect(
      ToolRelayMessageSchema.safeParse({
        type: 'register',
        job_id: 'j1',
        catalog_hash: 'abc',
        mcp_auth_token: 'tok',
      }).success
    ).toBe(true);
    expect(
      ToolRelayMessageSchema.safeParse({
        type: 'result',
        call_id: 'c1',
        job_id: 'j1',
        content: 'ok',
      }).success
    ).toBe(true);
  });
});
