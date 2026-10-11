import type { Server as HttpServer } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';

import { pino } from 'pino';

import { env } from '@/common/utils/envConfig';

import { connectorTokensMatch } from './connectorToken';

import {
  deliverRelayResult,
  enqueuePendingInvocation,
  getRelaySession,
  listPendingInvocations,
  registerRelaySession,
  stripRelayTransport,
  touchRelayHeartbeat,
} from './relaySession';
import { ToolRelayMessageSchema } from './toolCatalog.schema';

const logger = pino({ name: 'tool-relay-ws' });

const RELAY_PATH = '/tool-relay/v1';

export function attachToolRelayWebSocket(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = request.url ?? '';
    if (!url.startsWith(RELAY_PATH)) {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    let boundJobId: string | null = null;

    const sendInvoke = (payload: Record<string, unknown>) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    ws.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid_json' }));
        return;
      }
      const msg = ToolRelayMessageSchema.safeParse(parsed);
      if (!msg.success) {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid_message' }));
        return;
      }
      const data = msg.data;
      if (data.type === 'register') {
        const expected = env.MCP_AUTH_TOKEN || 'dummy-token';
        if (!connectorTokensMatch(data.mcp_auth_token, expected)) {
          ws.send(JSON.stringify({ type: 'error', message: 'invalid_token' }));
          ws.close();
          return;
        }
        registerRelaySession({
          jobId: data.job_id,
          catalogHash: data.catalog_hash,
          sendInvoke: (invoke) => sendInvoke(invoke),
        });
        boundJobId = data.job_id;
        const pending = listPendingInvocations(data.job_id);
        for (const p of pending) {
          sendInvoke({
            type: 'invoke',
            call_id: p.callId,
            job_id: p.jobId,
            handle: p.handle,
            name: p.name,
            arguments: p.arguments,
          });
        }
        ws.send(JSON.stringify({ type: 'registered', job_id: data.job_id, catalog_hash: data.catalog_hash }));
        return;
      }
      if (data.type === 'heartbeat') {
        touchRelayHeartbeat(data.job_id);
        ws.send(JSON.stringify({ type: 'heartbeat', job_id: data.job_id }));
        return;
      }
      if (data.type === 'result') {
        const session = getRelaySession(data.job_id);
        if (!session) {
          ws.send(JSON.stringify({ type: 'error', message: 'unknown_job' }));
          return;
        }
        deliverRelayResult({
          jobId: data.job_id,
          callId: data.call_id,
          content: data.content,
          isError: data.is_error,
        });
        return;
      }
    });

    ws.on('close', () => {
      if (boundJobId) {
        stripRelayTransport(boundJobId);
      }
    });
  });

  logger.info({ path: RELAY_PATH }, 'tool relay websocket attached');
  return wss;
}

export { RELAY_PATH };
