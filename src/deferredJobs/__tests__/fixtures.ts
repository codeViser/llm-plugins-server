import type { InferenceProfileV2 } from '../inferenceProfile';

export const OR_GATHER_PROFILE: InferenceProfileV2 = {
  schema_version: 2,
  ref: 'custom:8557d423-e2cf-4375-96be-40160a68bdfd',
  title: 'Luna-6-high',
  api_family: 'openrouter_chat_completions',
  model_slug: 'openai/gpt-6-luna',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  instructions: '',
  body_extensions: { reasoning_effort: 'high' },
  profile_hash: 'testhash1',
};

export const BATCH_THINK_PROFILE: InferenceProfileV2 = {
  schema_version: 2,
  ref: 'custom:batch-model',
  title: 'Luna batch',
  api_family: 'openrouter_batch',
  model_slug: 'openai/gpt-5.6-luna-pro:batch',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  body_extensions: { reasoning_effort: 'high' },
  profile_hash: 'testhash2',
};
