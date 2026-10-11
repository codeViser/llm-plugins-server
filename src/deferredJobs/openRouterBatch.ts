import got from 'got';

import { ensureBatchModelSlug } from './batchModelSlug';
import { openRouterBatchHttpError } from './openRouterBatchErrors';

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
  const batchModel = ensureBatchModelSlug(params.model);
  const requestBody = { ...params.body };
  if (typeof requestBody.model === 'string') {
    requestBody.model = ensureBatchModelSlug(requestBody.model);
  }
  const payload = {
    endpoint: params.endpoint,
    model: batchModel,
    requests: [{ custom_id: params.customId, body: requestBody }],
  };
  let res;
  try {
    res = await got.post(OR_BATCH_BASE, {
      json: payload,
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'json',
      timeout: { request: 120_000 },
    });
  } catch (error) {
    throw openRouterBatchHttpError(error, 'submit');
  }
  const raw = res.body as { id?: string; status?: string; data?: { id?: string; status?: string } };
  const id = raw.id ?? raw.data?.id;
  const status = raw.status ?? raw.data?.status;
  if (!id) {
    throw new Error('OpenRouter batch submit missing id');
  }
  return { id, status: status ?? 'validating' };
}

export async function getOpenRouterBatch(apiKey: string, batchId: string): Promise<BatchStatus> {
  let res;
  try {
    res = await got.get(`${OR_BATCH_BASE}/${encodeURIComponent(batchId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      responseType: 'json',
      timeout: { request: 60_000 },
    });
  } catch (error) {
    throw openRouterBatchHttpError(error, 'poll');
  }
  return res.body as BatchStatus;
}

const POLL_NOT_FOUND_RETRIES = 8;
const POLL_NOT_FOUND_BASE_MS = 2_000;

/** OR may return 404 briefly after 202 submit until the batch is readable. */
export async function getOpenRouterBatchWhenReady(
  apiKey: string,
  batchId: string,
  options: { notFoundRetries?: number } = {}
): Promise<BatchStatus> {
  const retries = options.notFoundRetries ?? POLL_NOT_FOUND_RETRIES;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await getOpenRouterBatch(apiKey, batchId);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isNotFound = /HTTP 404/i.test(message) || /not found/i.test(message);
      if (!isNotFound || attempt >= retries) {
        throw error;
      }
      const delay = POLL_NOT_FOUND_BASE_MS * (attempt + 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
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
