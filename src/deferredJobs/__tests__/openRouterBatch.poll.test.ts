import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gotGet = vi.hoisted(() => vi.fn());

vi.mock('got', () => ({
  default: {
    post: vi.fn(),
    get: gotGet,
  },
}));

import { getOpenRouterBatchWhenReady } from '../openRouterBatch';

describe('getOpenRouterBatchWhenReady', () => {
  beforeEach(() => {
    gotGet.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries 404 until batch becomes visible', async () => {
    gotGet
      .mockRejectedValueOnce({
        message: 'Response code 404 (Not Found)',
        response: { statusCode: 404, body: { error: { message: 'Batch job batch-x not found.' } } },
      })
      .mockResolvedValueOnce({
        body: { id: 'batch-x', status: 'completed', results: [] },
      });

    const statusPromise = getOpenRouterBatchWhenReady('key', 'batch-x', { notFoundRetries: 2 });
    await vi.runAllTimersAsync();
    const status = await statusPromise;
    expect(status.status).toBe('completed');
    expect(gotGet).toHaveBeenCalledTimes(2);
  });
});
