/** Apply optional reasoning effort to chat-completions request bodies (Gather + OR Batch Think). */

export type GatherProvider = 'openai' | 'openrouter';

const EFFORTS = new Set(['low', 'medium', 'high', 'minimal', 'none']);
const OPENROUTER_EFFORTS = new Set([...EFFORTS, 'xhigh', 'max']);

export function normalizeReasoningEffort(value?: string | null): string | undefined {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  const v = value.trim().toLowerCase();
  return EFFORTS.has(v) ? v : undefined;
}

/** OpenRouter chat/batch — keeps xhigh; maps TM "max" → xhigh. */
export function mapReasoningEffortForOpenRouter(value?: string | null): string | undefined {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  const v = value.trim().toLowerCase();
  if (!v || v === 'auto') {
    return undefined;
  }
  if (v === 'max') {
    return 'xhigh';
  }
  if (OPENROUTER_EFFORTS.has(v)) {
    return v;
  }
  return normalizeReasoningEffort(v);
}

/** OpenAI Responses — only documents low..high; TM max/xhigh → high. */
export function mapReasoningEffortForOpenAiResponses(value?: string | null): string | undefined {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  const v = value.trim().toLowerCase();
  if (!v || v === 'auto') {
    return undefined;
  }
  const normalized = normalizeReasoningEffort(v);
  if (normalized) {
    return normalized;
  }
  if (v === 'max' || v === 'xhigh') {
    return 'high';
  }
  return undefined;
}

export function resolveGatherProvider(args: {
  gatherProvider?: string | null;
  gatherModel: string;
  hasOpenaiKey: boolean;
  hasOpenrouterKey: boolean;
}): GatherProvider {
  const explicit = args.gatherProvider?.trim().toLowerCase();
  if (explicit === 'openai' || explicit === 'openrouter') {
    return explicit;
  }
  if (args.gatherModel.includes('/')) {
    return 'openrouter';
  }
  if (args.hasOpenaiKey && !args.hasOpenrouterKey) {
    return 'openai';
  }
  if (args.hasOpenrouterKey && !args.hasOpenaiKey) {
    return 'openrouter';
  }
  if (args.hasOpenrouterKey) {
    return 'openrouter';
  }
  return 'openai';
}

export function applyReasoningToChatBody(
  provider: GatherProvider,
  payload: Record<string, unknown>,
  reasoningEffort?: string
): void {
  const effort = normalizeReasoningEffort(reasoningEffort);
  if (!effort) {
    return;
  }
  if (provider === 'openrouter') {
    payload.reasoning_effort = effort;
    return;
  }
  // OpenAI chat-completions: reasoning models accept reasoning_effort; some also accept reasoning object.
  payload.reasoning_effort = effort;
  payload.reasoning = { effort };
}
