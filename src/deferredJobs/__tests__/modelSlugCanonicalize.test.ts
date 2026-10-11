import { describe, expect, it } from 'vitest';

import { canonicalizeInferenceProfile, canonicalizeOpenRouterModelKey } from '../modelSlugCanonicalize';

describe('modelSlugCanonicalize', () => {
  it('fixes haikyu → haiku in slugs', () => {
    expect(canonicalizeOpenRouterModelKey('anthropic/claude-haikyu-5.5')).toBe(
      'anthropic/claude-haiku-5.5'
    );
  });

  it('rewrites gather profile model fields consistently', () => {
    const fixed = canonicalizeInferenceProfile({
      schema_version: 2,
      model_id: 'anthropic/claude-haikyu-5.5',
      ref: 'anthropic/claude-haikyu-5.5',
      api_family: 'openrouter_chat_completions',
      model_slug: 'anthropic/claude-haikyu-5.5',
    });
    expect(fixed.model_slug).toBe('anthropic/claude-haiku-5.5');
    expect(fixed.model_id).toBe('anthropic/claude-haiku-5.5');
  });
});
