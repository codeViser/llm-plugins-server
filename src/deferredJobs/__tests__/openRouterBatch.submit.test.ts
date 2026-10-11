import { beforeEach, describe, expect, it, vi } from 'vitest';

const gotPost = vi.hoisted(() => vi.fn());

vi.mock('got', () => ({
  default: {
    post: gotPost,
    get: vi.fn(),
  },
}));

import { submitOpenRouterBatch } from '../openRouterBatch';

describe('submitOpenRouterBatch', () => {
  beforeEach(() => {
    gotPost.mockReset();
    gotPost.mockResolvedValue({ body: { id: 'batch-abc', status: 'validating' } });
  });

  it('adds :batch to top-level and request body model', async () => {
    await submitOpenRouterBatch({
      apiKey: 'key',
      endpoint: '/v1/chat/completions',
      model: 'anthropic/claude-sonnet-5.5',
      customId: 'job-think-0',
      body: { model: 'anthropic/claude-sonnet-5.5', messages: [{ role: 'user', content: 'hi' }] },
    });
    const payload = (gotPost.mock.calls[0][1] as { json: Record<string, unknown> }).json;
    expect(payload.model).toBe('anthropic/claude-sonnet-5.5:batch');
    const reqBody = (payload.requests as Array<{ body: { model: string } }>)[0].body;
    expect(reqBody.model).toBe('anthropic/claude-sonnet-5.5:batch');
  });
});
