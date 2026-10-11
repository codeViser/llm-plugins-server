import { describe, expect, it } from 'vitest';

import { toolsParityReport } from '../parityTools';

describe('toolsParityReport', () => {
  it('fails strict mode when MCP missing on Pi', () => {
    const r = toolsParityReport({
      pi_tools_hash: 'abc',
      pi_tool_count: 1,
      mcp_missing_on_pi: ['pipe::x'],
      parity_strict: true,
    });
    expect(r.ok).toBe(false);
  });

  it('passes strict mode when MCP aligned', () => {
    const r = toolsParityReport({
      pi_tools_hash: 'abc',
      pi_tool_count: 1,
      mcp_missing_on_pi: [],
      parity_strict: true,
    });
    expect(r.ok).toBe(true);
  });
});
