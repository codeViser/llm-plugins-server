/** Apply optional reasoning effort to chat-completions request bodies (Gather + OR Batch Think). */

export type GatherProvider = 'openai' | 'openrouter';

const EFFORTS = new Set(['low', 'medium', 'high', 'minimal', 'none']);

export function normalizeReasoningEffort(value?: string | null): string | undefined {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  const v = value.trim().toLowerCase();
  return EFFORTS.has(v) ? v : undefined;
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
