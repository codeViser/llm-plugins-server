import type { InferenceProfileV2 } from './inferenceProfile';
import { runGatherAgent } from './gatherAgent';
import { runResponsesProfileGather } from './responsesGatherAgent';
import type { EvidencePacket } from './schemas';

export type ProfileGatherOutput = {
  packet: EvidencePacket;
  toolsInvoked: string[];
  finalAssistantText: string;
  config_echo: {
    gather_api_family: string;
    gather_profile_hash: string;
    gather_ref: string;
  };
};

export async function runProfileGather(args: {
  profile: InferenceProfileV2;
  goal: string;
  contextPacket?: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  allowMcpClients?: string[];
  denyMcpClients?: string[];
  maxTurns: number;
  maxToolCalls: number;
}): Promise<ProfileGatherOutput> {
  const family = args.profile.api_family;

  if (family === 'openai_responses') {
    if (!args.openaiApiKey) {
      throw new Error('openai_api_key required for native gather profile');
    }
    const r = await runResponsesProfileGather({
      profile: args.profile,
      goal: args.goal,
      contextPacket: args.contextPacket,
      openaiApiKey: args.openaiApiKey,
      allowMcpClients: args.allowMcpClients,
      denyMcpClients: args.denyMcpClients,
      maxTurns: args.maxTurns,
      maxToolCalls: args.maxToolCalls,
    });
    return {
      packet: r.packet,
      toolsInvoked: r.toolsInvoked,
      finalAssistantText: r.finalAssistantText,
      config_echo: {
        gather_api_family: r.api_family,
        gather_profile_hash: r.profile_hash,
        gather_ref: args.profile.ref,
      },
    };
  }

  if (family === 'openrouter_chat_completions') {
    if (!args.openrouterApiKey) {
      throw new Error('openrouter_api_key required for custom OR gather profile');
    }
    const r = await runGatherAgent({
      goal: args.goal,
      contextPacket: args.contextPacket,
      gatherModel: args.profile.model_slug,
      gatherProvider: 'openrouter',
      gatherReasoningEffort: String(args.profile.body_extensions?.reasoning_effort ?? args.profile.reasoning?.effort ?? ''),
      openrouterApiKey: args.openrouterApiKey,
      profile: args.profile,
      allowMcpClients: args.allowMcpClients,
      denyMcpClients: args.denyMcpClients,
      maxTurns: args.maxTurns,
      maxToolCalls: args.maxToolCalls,
    });
    return {
      packet: r.packet,
      toolsInvoked: r.toolsInvoked,
      finalAssistantText: r.finalAssistantText,
      config_echo: {
        gather_api_family: family,
        gather_profile_hash: args.profile.profile_hash ?? '',
        gather_ref: args.profile.ref,
      },
    };
  }

  throw new Error(`gather profile api_family ${family} cannot run sync tool gather`);
}
