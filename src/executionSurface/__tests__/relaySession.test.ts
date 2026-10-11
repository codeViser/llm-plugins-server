import { describe, expect, it } from 'vitest';

import {
  deliverRelayResult,
  invokeClientTool,
  listPendingInvocations,
  registerRelaySession,
} from '../relaySession';

describe('relaySession', () => {
  it('queues pending invocations for poll fallback', async () => {
    registerRelaySession({
      jobId: 'j-poll',
      catalogHash: 'hash1',
    });
    const pending = invokeClientTool({
      jobId: 'j-poll',
      catalogHash: 'hash1',
      handle: 'plugin:x',
      name: 'x',
      arguments: {},
      timeoutMs: 50,
    });
    expect(listPendingInvocations('j-poll').length).toBe(1);
    const callId = listPendingInvocations('j-poll')[0].callId;
    deliverRelayResult({ jobId: 'j-poll', callId, content: 'done' });
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.text).toBe('done');
  });
});
