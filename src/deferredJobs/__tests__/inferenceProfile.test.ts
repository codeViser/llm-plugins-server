import { describe, expect, it } from 'vitest';

import { buildOpenRouterChatBody, buildThinkBatchBody } from '../inferenceProfile';
import { OR_GATHER_PROFILE } from './fixtures';

describe('inferenceProfile builders', () => {
  it('merges body_extensions for OR chat', () => {
    const body = buildOpenRouterChatBody(OR_GATHER_PROFILE, [{ role: 'user', content: 'hi' }]);
    expect(body.model).toBe('openai/gpt-6-luna');
    expect(body.reasoning_effort).toBe('high');
  });

  it('builds batch think body', () => {
    const body = buildThinkBatchBody(
      {
        ...OR_GATHER_PROFILE,
        api_family: 'openrouter_batch',
        model_slug: 'openai/x:batch',
      },
      'think'
    );
    expect(body.messages).toBeTruthy();
  });
});
