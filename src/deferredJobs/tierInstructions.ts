import type { InferenceProfileV2 } from './inferenceProfile';

export const GATHER_TIER_ADDENDUM =
  'Deferred gather tier: use MCP tools when you need external facts, then answer the research goal.';

export const THINK_TIER_ADDENDUM =
  'Deferred think tier: synthesize the best final answer from the evidence packet.';

/** Preserve TM system/instructions; append only a short job-specific addendum. */
export function composeTierInstructions(tmInstructions: string | undefined, addendum: string): string {
  const tm = (tmInstructions ?? '').trim();
  if (!tm) {
    return addendum;
  }
  return `${tm}\n\n---\n\n${addendum}`;
}

export function gatherSystemContent(profile: InferenceProfileV2, contextPacket?: string): string {
  const base = composeTierInstructions(profile.instructions, GATHER_TIER_ADDENDUM);
  if (!contextPacket?.trim()) {
    return base;
  }
  return `${base}\n\nContext from TypingMind:\n${contextPacket.trim()}`;
}

export function thinkInstructions(profile: InferenceProfileV2): string {
  return composeTierInstructions(profile.instructions, THINK_TIER_ADDENDUM);
}
