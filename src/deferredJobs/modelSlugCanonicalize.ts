import type { InferenceProfileV2 } from './inferenceProfile';

/**
 * Fix common TypingMind / user typos before hitting provider APIs.
 * (e.g. display title "Haikyu" vs OpenRouter `anthropic/claude-haiku-5.5`.)
 */
export function canonicalizeOpenRouterModelKey(modelKey: string): string {
  const key = String(modelKey || '').trim();
  if (!key) {
    return key;
  }
  return key.replace(/haikyu/gi, 'haiku');
}

export function canonicalizeInferenceProfile(profile: InferenceProfileV2): InferenceProfileV2 {
  const slug = canonicalizeOpenRouterModelKey(profile.model_slug);
  if (slug === profile.model_slug) {
    return profile;
  }
  const modelId = profile.model_id ? canonicalizeOpenRouterModelKey(profile.model_id) : slug;
  const ref = profile.ref ? canonicalizeOpenRouterModelKey(profile.ref) : modelId;
  return {
    ...profile,
    model_slug: slug,
    model_id: modelId,
    ref,
  };
}
