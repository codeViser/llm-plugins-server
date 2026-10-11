import { describe, expect, it } from 'vitest';

import {
  applyReasoningToChatBody,
  mapReasoningEffortForOpenAiResponses,
  mapReasoningEffortForOpenRouter,
  resolveGatherProvider,
} from '../reasoningParams';

describe('reasoningParams', () => {
  it('resolves gather provider from explicit setting', () => {
    expect(
      resolveGatherProvider({
        gatherProvider: 'openai',
        gatherModel: 'openai/gpt-4o-mini',
        hasOpenaiKey: true,
        hasOpenrouterKey: true,
      })
    ).toBe('openai');
  });

  it('infers openrouter from model slug with slash', () => {
    expect(
      resolveGatherProvider({
        gatherModel: 'openai/gpt-4o-mini',
        hasOpenaiKey: true,
        hasOpenrouterKey: true,
      })
    ).toBe('openrouter');
  });

  it('applies reasoning_effort for OpenRouter', () => {
    const body: Record<string, unknown> = { model: 'x' };
    applyReasoningToChatBody('openrouter', body, 'high');
    expect(body.reasoning_effort).toBe('high');
  });

  it('maps max to xhigh for OpenRouter wire', () => {
    expect(mapReasoningEffortForOpenRouter('max')).toBe('xhigh');
  });

  it('maps max to high for OpenAI Responses wire', () => {
    expect(mapReasoningEffortForOpenAiResponses('max')).toBe('high');
  });
});
