import got from 'got';

const OR_BATCH_BASE = 'https://openrouter.ai/api/v1/batches';

export type BatchSubmitParams = {
  apiKey: string;
  endpoint: '/v1/chat/completions' | '/v1/responses';
  model: string;
  customId: string;
  body: Record<string, unknown>;
};

export type BatchStatus = {
  id: string;
  status: string;
  results?: Array<{
    custom_id: string;
    response?: { body?: unknown };
    error?: unknown;
  }>;
  usage?: { cost?: number };
};

export async function submitOpenRouterBatch(params: BatchSubmitParams): Promise<{ id: string; status: string }> {
  const payload = {
    endpoint: params.endpoint,
    model: params.model,
    requests: [{ custom_id: params.customId, body: params.body }],
  };
  const res = await got.post(OR_BATCH_BASE, {
    json: payload,
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    responseType: 'json',
    timeout: { request: 120_000 },
  });
  const body = res.body as { id?: string; status?: string };
  if (!body.id) {
    throw new Error('OpenRouter batch submit missing id');
  }
  return { id: body.id, status: body.status ?? 'validating' };
}

export async function getOpenRouterBatch(apiKey: string, batchId: string): Promise<BatchStatus> {
  const res = await got.get(`${OR_BATCH_BASE}/${batchId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    responseType: 'json',
    timeout: { request: 60_000 },
  });
  return res.body as BatchStatus;
}

const TERMINAL = new Set(['completed', 'failed', 'expired', 'cancelled']);

export function isTerminalBatchStatus(status: string): boolean {
  return TERMINAL.has(status);
}

/** Backoff delays in ms for poller (capped). */
export function batchPollDelayMs(attempt: number): number {
  const schedule = [30_000, 60_000, 120_000, 180_000, 300_000];
  return schedule[Math.min(attempt, schedule.length - 1)];
}

export function extractBatchCompletionText(status: BatchStatus, customId: string): string {
  const row = status.results?.find((r) => r.custom_id === customId);
  if (!row?.response?.body) {
    throw new Error('Batch completed without response body for custom_id');
  }
  const body = row.response.body as {
    choices?: Array<{ message?: { content?: string } }>;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const chat = body.choices?.[0]?.message?.content;
  if (typeof chat === 'string' && chat.length) {
    return chat;
  }
  const responsesText = body.output?.flatMap((o) => o.content?.map((c) => c.text ?? '') ?? []).join('');
  if (responsesText) {
    return responsesText;
  }
  return JSON.stringify(body);
}
