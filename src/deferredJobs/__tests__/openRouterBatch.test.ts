import { describe, expect, it } from 'vitest';

import { batchPollDelayMs, isTerminalBatchStatus } from '../openRouterBatch';

describe('openRouterBatch helpers', () => {
  it('recognizes terminal batch statuses', () => {
    expect(isTerminalBatchStatus('completed')).toBe(true);
    expect(isTerminalBatchStatus('failed')).toBe(true);
    expect(isTerminalBatchStatus('in_progress')).toBe(false);
  });

  it('caps poll backoff', () => {
    expect(batchPollDelayMs(0)).toBe(30_000);
    expect(batchPollDelayMs(100)).toBe(300_000);
  });
});
