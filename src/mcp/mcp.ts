import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import path from 'path';

import { pino } from 'pino';

const logger = pino({ name: 'mcp-server' });

// Managed workspace for all MCP subprocess artifacts (git-ignored via data/)
const MCP_WORKSPACE_DIR = path.join(process.cwd(), 'data', 'mcp-workspace');
fs.mkdirSync(MCP_WORKSPACE_DIR, { recursive: true });

// Store active MCP clients
export const clients = new Map<
  string,
  {
    id: string;
    client: Client;
    transport: StdioClientTransport;
    command: string;
    args: string[];
    env: Record<string, string>;
    config: any;
    createdAt: Date;
  }
>();

// Helper function to start a client with given configuration
export async function startClient(clientId: string, config: any) {
  const { command, args = [], env = {} } = config;

  if (!command) {
    throw new Error('Command is required');
  }

  // Create transport for the MCP client
  const transport = new StdioClientTransport({
    command,
    args,
    cwd: config.cwd || MCP_WORKSPACE_DIR,
    env:
      Object.values(env).length > 0
        ? {
            // see https://github.com/modelcontextprotocol/typescript-sdk/issues/216
            ...getDefaultEnvironment(),
            ...env,
          }
        : undefined, // cannot be {}, it will cause error
  });

  // Create and initialize the client
  const client = new Client({
    name: `mcp-http-bridge-${clientId}`,
    version: '1.0.0',
  });

  // Connect the client to the transport
  await client.connect(transport);

  // Store the client with its ID
  clients.set(clientId, {
    id: clientId,
    client,
    transport,
    command,
    args,
    env,
    config, // Store original config for restart
    createdAt: new Date(),
  });

  return {
    id: clientId,
    message: 'MCP client started successfully',
  };
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  logger.info('Shutting down server...');

  // Close all clients
  for (const [id, clientEntry] of clients.entries()) {
    try {
      await clientEntry.client.close();
      logger.info(`Closed client ${id}`);
    } catch (error) {
      logger.error(`Error closing client ${id}:`, error);
    }
  }

  process.exit(0);
});
