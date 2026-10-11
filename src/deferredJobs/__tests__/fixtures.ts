import type { InferenceProfileV2 } from '../inferenceProfile';

export const OR_GATHER_PROFILE: InferenceProfileV2 = {
  schema_version: 2,
  model_id: 'openai/gpt-6-luna',
  title: 'Luna-6-high',
  api_family: 'openrouter_chat_completions',
  model_slug: 'openai/gpt-6-luna',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  instructions: '',
  body_extensions: { reasoning_effort: 'high' },
};

export const BATCH_THINK_PROFILE: InferenceProfileV2 = {
  schema_version: 2,
  model_id: 'openai/gpt-5.6-luna-pro:batch',
  title: 'Luna batch',
  api_family: 'openrouter_batch',
  model_slug: 'openai/gpt-5.6-luna-pro:batch',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  body_extensions: { reasoning_effort: 'high' },
};

export const NATIVE_GATHER_PROFILE: InferenceProfileV2 = {
  schema_version: 2,
  model_id: 'gpt-6-luna',
  api_family: 'openai_responses',
  model_slug: 'gpt-6-luna',
  reasoning: { effort: 'high', summary: 'auto' },
};
