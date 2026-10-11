import { mapReasoningEffortForOpenRouter } from './reasoningParams';

/**
 * OpenRouter unified `reasoning_effort` is not accepted by all providers.
 * Claude Haiku routes often return opaque "Provider returned error" when it is set
 * (especially alongside tool definitions).
 */
export function openRouterReasoningWire(
  modelSlug: string,
  effortInput: string | undefined,
  toolCount: number
): Record<string, unknown> {
  const effort = mapReasoningEffortForOpenRouter(effortInput);
  if (!effort) {
    return {};
  }
  if (/anthropic\/claude-haiku/i.test(modelSlug)) {
    return {};
  }
  if (toolCount > 0 && /^anthropic\//i.test(modelSlug)) {
    return {};
  }
  return { reasoning_effort: effort };
}
