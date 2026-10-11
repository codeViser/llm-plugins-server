import { createServer } from 'http';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { attachToolRelayWebSocket } from '../relayWsServer';
import { invokeClientTool } from '../relaySession';

describe('tool relay websocket', () => {
  it(
    'delivers invoke over ws and accepts result',
    async () => {
      const httpServer = createServer();
      attachToolRelayWebSocket(httpServer);
      await new Promise<void>((resolve) => httpServer.listen(0, resolve));
      const port = (httpServer.address() as { port: number }).port;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/tool-relay/v1`);
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
      });

      const registered = new Promise<void>((resolve) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(String(raw));
          if (msg.type === 'registered') resolve();
          if (msg.type === 'invoke') {
            ws.send(
              JSON.stringify({
                type: 'result',
                call_id: msg.call_id,
                job_id: msg.job_id,
                content: 'from-ws',
              })
            );
          }
        });
      });

      ws.send(
        JSON.stringify({
          type: 'register',
          job_id: 'ws-job',
          catalog_hash: 'hash-aaaaaaaa',
          mcp_auth_token: 'dummy-token',
        })
      );

      await registered;

      const result = await invokeClientTool({
        jobId: 'ws-job',
        catalogHash: 'hash-aaaaaaaa',
        handle: 'plugin:y',
        name: 'y',
        arguments: {},
        timeoutMs: 5000,
      });
      expect(result.ok).toBe(true);
      expect(result.text).toBe('from-ws');

      ws.close();
      httpServer.close();
    },
    15_000
  );
});
