import type { InferenceProfileV2 } from './inferenceProfile';

export const GATHER_TIER_ADDENDUM =
  'Deferred gather tier (orchestration): use MCP tools on the connector for external facts. ' +
  'You may receive follow-up evidence_requests from the think tier — run tools again to fill gaps before answering. ' +
  'This tier runs on the Pi connector; the TypingMind browser does not need to stay open after the job starts.';

export const THINK_TIER_ADDENDUM =
  'Deferred think tier (deep synthesis): produce the best final answer from the evidence packet. ' +
  'If critical gaps remain, include evidence_requests (max 3) so the gather tier can run another tool pass.';

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
