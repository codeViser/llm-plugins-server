import { describe, expect, it } from 'vitest';

import { buildOpenRouterChatBody } from '../inferenceProfile';
import { openRouterReasoningWire } from '../openRouterWire';

describe('openRouterWire', () => {
  it('omits reasoning_effort for Claude Haiku', () => {
    expect(openRouterReasoningWire('anthropic/claude-haiku-5.5', 'low', 3)).toEqual({});
  });

  it('keeps reasoning_effort for Claude Sonnet without tools', () => {
    expect(openRouterReasoningWire('anthropic/claude-sonnet-5.5', 'medium', 0)).toEqual({
      reasoning_effort: 'medium',
    });
  });

  it('buildOpenRouterChatBody does not leak reasoning_effort for Haiku with tools', () => {
    const body = buildOpenRouterChatBody(
      {
        schema_version: 2,
        model_id: 'anthropic/claude-haiku-5.5',
        api_family: 'openrouter_chat_completions',
        model_slug: 'anthropic/claude-haiku-5.5',
        body_extensions: { reasoning_effort: 'low', stream: false },
      },
      [{ role: 'user', content: 'hi' }],
      [{ type: 'function', function: { name: 'ma_0', parameters: { type: 'object' } } }]
    );
    expect(body.model).toBe('anthropic/claude-haiku-5.5');
    expect(body.reasoning_effort).toBeUndefined();
  });
});
