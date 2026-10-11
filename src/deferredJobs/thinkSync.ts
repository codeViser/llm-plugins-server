import got from 'got';

import { runBackgroundResponsesTurn } from '@/multiAgent/openaiBackgroundTurn';

import type { InferenceProfileV2 } from './inferenceProfile';
import { buildOpenAiResponsesBody, buildOpenRouterChatBody } from './inferenceProfile';
import { thinkInstructions } from './tierInstructions';

async function responsesHttp(apiKey: string) {
  return {
    create: (body: Record<string, unknown>, timeoutMs: number) =>
      got
        .post('https://api.openai.com/v1/responses', {
          json: { ...body, background: true, store: true },
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          responseType: 'json',
          timeout: { request: timeoutMs },
        })
        .then((r) => r.body as Record<string, unknown>),
    retrieve: (id: string, timeoutMs: number) =>
      got
        .get(`https://api.openai.com/v1/responses/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          responseType: 'json',
          timeout: { request: timeoutMs },
        })
        .then((r) => r.body as Record<string, unknown>),
  };
}

function extractResponsesText(output: Array<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const item of output) {
    if (item.type !== 'message') continue;
    const content = item.content as Array<{ text?: string }> | undefined;
    for (const c of content ?? []) {
      if (c.text) parts.push(c.text);
    }
  }
  return parts.join('\n').trim();
}

export async function runProfileThinkSync(args: {
  profile: InferenceProfileV2;
  userContent: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
}): Promise<{ text: string; api_family: string }> {
  const family = args.profile.api_family;
  const instructions = thinkInstructions(args.profile);

  if (family === 'openai_responses') {
    if (!args.openaiApiKey) {
      throw new Error('openai_api_key required for native think profile');
    }
    const body = buildOpenAiResponsesBody(
      { ...args.profile, instructions },
      args.userContent,
      []
    );
    const result = await runBackgroundResponsesTurn({
      body,
      timeoutMs: 300_000,
      http: await responsesHttp(args.openaiApiKey),
    });
    const text = extractResponsesText((result.output ?? []) as Array<Record<string, unknown>>);
    return { text, api_family: family };
  }

  if (family === 'openrouter_chat_completions' || family === 'openrouter_batch') {
    if (!args.openrouterApiKey) {
      throw new Error('openrouter_api_key required for OR think profile');
    }
    const url = args.profile.endpoint || 'https://openrouter.ai/api/v1/chat/completions';
    const payload = buildOpenRouterChatBody(
      args.profile,
      [
        { role: 'system', content: instructions },
        { role: 'user', content: args.userContent },
      ],
      []
    );
    const res = await got.post(url, {
      json: payload,
      headers: {
        Authorization: `Bearer ${args.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://typingmind.com',
        'X-Title': 'DeferredResearchThink',
      },
      responseType: 'json',
      timeout: { request: 300_000 },
    });
    const raw = res.body as { choices?: Array<{ message?: { content?: string } }> };
    const text = raw.choices?.[0]?.message?.content ?? '';
    return { text, api_family: family === 'openrouter_batch' ? 'openrouter_chat_completions' : family };
  }

  throw new Error(`think profile api_family ${family} is not supported for sync think`);
}
