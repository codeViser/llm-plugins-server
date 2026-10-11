import { describe, expect, it } from 'vitest';

import {
  buildOpenAiResponsesBody,
  buildOpenRouterChatBody,
  buildThinkBatchBody,
  mergeProfileReasoningOverride,
} from '../inferenceProfile';
import { OR_GATHER_PROFILE } from './fixtures';

describe('inferenceProfile builders', () => {
  it('merges body_extensions for OR chat', () => {
    const body = buildOpenRouterChatBody(OR_GATHER_PROFILE, [{ role: 'user', content: 'hi' }]);
    expect(body.model).toBe('openai/gpt-6-luna');
    expect(body.reasoning_effort).toBe('high');
  });

  it('maps maxTokens string to max_tokens', () => {
    const body = buildOpenRouterChatBody(
      {
        ...OR_GATHER_PROFILE,
        body_extensions: { maxTokens: '100000', reasoning_effort: 'high' },
      },
      [{ role: 'user', content: 'hi' }]
    );
    expect(body.max_tokens).toBe(100000);
  });

  it('mergeProfileReasoningOverride sets OR reasoning_effort', () => {
    const merged = mergeProfileReasoningOverride(OR_GATHER_PROFILE, 'xhigh');
    expect(merged.body_extensions?.reasoning_effort).toBe('xhigh');
  });

  it('maps TM max reasoning to OR xhigh on chat body', () => {
    const body = buildOpenRouterChatBody(
      {
        ...OR_GATHER_PROFILE,
        body_extensions: { reasoning_effort: 'max' },
      },
      [{ role: 'user', content: 'hi' }]
    );
    expect(body.reasoning_effort).toBe('xhigh');
  });

  it('maps TM max reasoning to high on Responses body', () => {
    const body = buildOpenAiResponsesBody(
      {
        ...OR_GATHER_PROFILE,
        api_family: 'openai_responses',
        model_slug: 'gpt-6-luna',
        reasoning: { effort: 'max', summary: 'auto' },
      },
      'input'
    );
    expect((body.reasoning as { effort: string }).effort).toBe('high');
  });

  it('mergeProfileReasoningOverride sets native reasoning object', () => {
    const merged = mergeProfileReasoningOverride(
      { ...OR_GATHER_PROFILE, api_family: 'openai_responses', model_slug: 'gpt-6-luna' },
      'high'
    );
    expect(merged.reasoning?.effort).toBe('high');
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
