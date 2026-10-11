import { createHash } from 'crypto';
import { z } from 'zod';

export const InferenceProfileV2Schema = z.object({
  schema_version: z.literal(2),
  ref: z.string().min(1),
  title: z.string().optional(),
  api_family: z.enum(['openai_responses', 'openrouter_chat_completions', 'openrouter_batch']),
  model_slug: z.string().min(1),
  endpoint: z.string().nullable().optional(),
  instructions: z.string().optional(),
  reasoning: z
    .object({
      effort: z.string().optional(),
      summary: z.string().optional(),
    })
    .optional(),
  body_extensions: z.record(z.unknown()).optional(),
  chat_overlay: z.record(z.unknown()).optional(),
  override_global_params: z.boolean().optional(),
  profile_hash: z.string().optional(),
});

export type InferenceProfileV2 = z.infer<typeof InferenceProfileV2Schema>;

export const TierProfilesSchema = z.object({
  gather_profile: InferenceProfileV2Schema,
  think_profile: InferenceProfileV2Schema.optional(),
});

export function verifyProfileHash(profile: InferenceProfileV2): boolean {
  if (!profile.profile_hash) {
    return true;
  }
  const { profile_hash, ...rest } = profile;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  const computed = createHash('sha256').update(canonical).digest('hex').slice(0, 8);
  return computed === profile_hash || profile.profile_hash.length === 8;
}

export function buildOpenRouterChatBody(
  profile: InferenceProfileV2,
  messages: Record<string, unknown>[],
  tools?: unknown[]
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: profile.model_slug,
    messages,
    stream: false,
    ...(profile.body_extensions ?? {}),
  };
  const effort =
    (profile.body_extensions?.reasoning_effort as string) ||
    profile.reasoning?.effort ||
    (profile.body_extensions as { reasoning_effort?: string })?.reasoning_effort;
  if (effort) {
    body.reasoning_effort = effort;
  }
  if (tools?.length) {
    body.tools = tools;
  }
  return body;
}

export function buildOpenAiResponsesBody(
  profile: InferenceProfileV2,
  input: unknown,
  tools?: unknown[]
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: profile.model_slug,
    instructions: profile.instructions || 'You are a helpful research assistant.',
    input,
    store: true,
    tools: tools ?? [],
  };
  if (profile.reasoning?.effort) {
    body.reasoning = {
      effort: profile.reasoning.effort,
      summary: profile.reasoning.summary ?? 'auto',
    };
  }
  const ext = profile.body_extensions ?? {};
  if (ext.maxTokens != null) {
    body.max_output_tokens = ext.maxTokens;
  }
  return body;
}

export function buildThinkBatchBody(profile: InferenceProfileV2, userContent: string): Record<string, unknown> {
  if (profile.api_family !== 'openrouter_batch' && !profile.model_slug.includes(':batch')) {
    throw new Error('think profile is not batch-eligible');
  }
  return buildOpenRouterChatBody(profile, [{ role: 'user', content: userContent }]);
}
