import { describe, expect, it } from 'vitest';

import { resolveMcpAllowList } from '../mcpAllow';

describe('resolveMcpAllowList', () => {
  it('intersects TM MCP ids with Pi clients', () => {
    const r = resolveMcpAllowList({
      piClientIds: ['pipe::sequential-thinking', 'store::memory'],
      tmContext: { mcp_server_ids: ['pipe::sequential-thinking', 'missing::x'] },
    });
    expect(r.allow).toEqual(['pipe::sequential-thinking']);
    expect(r.missingOnPi).toEqual(['missing::x']);
  });

  it('prefers explicit allow', () => {
    const r = resolveMcpAllowList({
      piClientIds: ['a'],
      tmContext: { mcp_server_ids: ['b'] },
      explicitAllow: ['a'],
    });
    expect(r.allow).toEqual(['a']);
  });
});
