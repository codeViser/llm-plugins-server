import { describe, expect, it } from 'vitest';

import { bindToolsForOpenAI, encodeMcpToolName } from '@/multiAgent/toolBridge';

import { decodeTmToolName, encodeTmToolName, parseMcpHandle } from '../toolNameCodec';

describe('toolNameCodec', () => {
  it('round-trips tm client tool names', () => {
    const handle = 'plugin:tavily_search';
    const encoded = encodeTmToolName(handle, 'tavily_search');
    expect(decodeTmToolName(encoded)).toEqual({ handle, functionName: 'tavily_search' });
  });

  it('parses mcp handles', () => {
    expect(parseMcpHandle('mcp:search::playwright')).toBe('search::playwright');
    expect(parseMcpHandle('plugin:x')).toBeNull();
  });

  it('ma_* bind names do not collide with mcp/tm prefixes', () => {
    const tools = [
      {
        type: 'function' as const,
        name: encodeMcpToolName('search::playwright', 'navigate'),
        description: 'd',
        parameters: { type: 'object', properties: {} },
      },
      {
        type: 'function' as const,
        name: encodeTmToolName('plugin:tavily_search', 'tavily_search'),
        description: 'd',
        parameters: { type: 'object', properties: {} },
      },
    ];
    const { tools: bound, resolve } = bindToolsForOpenAI(tools);
    expect(bound[0].name).toBe('ma_0');
    expect(resolve('ma_0')).toBe(tools[0].name);
    expect(resolve('ma_1')).toBe(tools[1].name);
  });
});
