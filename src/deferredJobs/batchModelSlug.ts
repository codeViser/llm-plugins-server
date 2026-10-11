import type { InferenceProfileV2 } from './inferenceProfile';

const BATCH_SUFFIX = /:batch$/i;

/** OpenRouter Batch API top-level `model` must be a `:batch` variant when applicable. */
export function ensureBatchModelSlug(modelSlug: string): string {
  const slug = String(modelSlug || '').trim();
  if (!slug) {
    return slug;
  }
  return BATCH_SUFFIX.test(slug) ? slug : `${slug}:batch`;
}

export function stripBatchModelSuffix(modelSlug: string): string {
  return String(modelSlug || '').trim().replace(BATCH_SUFFIX, '');
}

/** Sync OR chat completions use the non-batch slug. */
export function thinkProfileForSyncChat(profile: InferenceProfileV2): InferenceProfileV2 {
  const slug = stripBatchModelSuffix(profile.model_slug);
  const modelId = profile.model_id ? stripBatchModelSuffix(profile.model_id) : slug;
  return {
    ...profile,
    api_family: 'openrouter_chat_completions',
    model_slug: slug,
    model_id: modelId,
    ref: profile.ref ? stripBatchModelSuffix(profile.ref) : modelId,
  };
}
