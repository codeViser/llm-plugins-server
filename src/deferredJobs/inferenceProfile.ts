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

function numericMaxTokens(ext: Record<string, unknown>): number | undefined {
  const raw = ext.maxTokens ?? ext.max_tokens;
  if (raw == null) return undefined;
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function buildOpenRouterChatBody(
  profile: InferenceProfileV2,
  messages: Record<string, unknown>[],
  tools?: unknown[]
): Record<string, unknown> {
  const ext = { ...(profile.body_extensions ?? {}) };
  const { thinkingOptions: _t, promptCachingEnabled: _p, contextLimit: _c, ...wireExt } = ext;
  const body: Record<string, unknown> = {
    model: profile.model_slug,
    messages,
    stream: false,
    ...wireExt,
  };
  const effort =
    (ext.reasoning_effort as string) ||
    profile.reasoning?.effort ||
    (ext as { reasoning_effort?: string }).reasoning_effort;
  if (effort) {
    body.reasoning_effort = effort;
  }
  const maxTok = numericMaxTokens(ext);
  if (maxTok) {
    body.max_tokens = maxTok;
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
  const maxTok = numericMaxTokens(ext as Record<string, unknown>);
  if (maxTok) {
    body.max_output_tokens = maxTok;
  }
  if (ext.promptCachingEnabled === 'extended' || ext.promptCachingEnabled === true) {
    body.store = true;
  }
  return body;
}

export function buildThinkBatchBody(profile: InferenceProfileV2, userContent: string): Record<string, unknown> {
  if (profile.api_family !== 'openrouter_batch' && !profile.model_slug.includes(':batch')) {
    throw new Error('think profile is not batch-eligible');
  }
  return buildOpenRouterChatBody(profile, [{ role: 'user', content: userContent }]);
}
