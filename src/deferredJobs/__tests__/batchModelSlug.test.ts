import { describe, expect, it } from 'vitest';

import { ensureBatchModelSlug, stripBatchModelSuffix, thinkProfileForSyncChat } from '../batchModelSlug';

describe('batchModelSlug', () => {
  it('ensures :batch suffix for batch API model field', () => {
    expect(ensureBatchModelSlug('anthropic/claude-sonnet-5.5')).toBe('anthropic/claude-sonnet-5.5:batch');
    expect(ensureBatchModelSlug('anthropic/claude-sonnet-5.5:batch')).toBe('anthropic/claude-sonnet-5.5:batch');
  });

  it('strips :batch for sync chat', () => {
    expect(stripBatchModelSuffix('openai/gpt-6-luna-pro:batch')).toBe('openai/gpt-6-luna-pro');
  });

  it('maps batch think profile to sync OR profile', () => {
    const sync = thinkProfileForSyncChat({
      schema_version: 2,
      model_id: 'anthropic/claude-sonnet-5.5:batch',
      api_family: 'openrouter_batch',
      model_slug: 'anthropic/claude-sonnet-5.5:batch',
    });
    expect(sync.api_family).toBe('openrouter_chat_completions');
    expect(sync.model_slug).toBe('anthropic/claude-sonnet-5.5');
  });
});
