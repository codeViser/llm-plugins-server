import { Request, Response, Router } from 'express';
import stringify from 'json-stable-stringify';
import { pino } from 'pino';

import { env } from '@/common/utils/envConfig';

import { clients, startClient } from './mcp';
import { authMiddleware } from './mcp.auth';

const mcpRouter = Router();
const logger = pino({ name: 'mcp-router' });

const authToken = env.MCP_AUTH_TOKEN;
if (!authToken) {
  logger.warn('MCP_AUTH_TOKEN is not set. MCP routes will be unprotected.');
}
const auth = authMiddleware(authToken || 'dummy-token');

// Health check endpoint
mcpRouter.get('/ping', auth, (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Start MCP clients using Claude Desktop config format
mcpRouter.post('/start', auth, async (req: Request, res: Response) => {
  try {
    const { mcpServers } = req.body;

    const results = {
      success: [],
      errors: [],
    };

    // Process each server configuration
    const startPromises = Object.entries(mcpServers).map(async ([serverId, config]) => {
      try {
        // Check if this client already exists
        if (clients.has(serverId)) {
          const hasConfigChanged = stringify(clients.get(serverId)?.config) !== stringify(config);
          if (!hasConfigChanged) {
            return;
          }
          logger.info('Restarting client with new config:', serverId);
          await clients.get(serverId)?.client.close();
        }

        const result = await startClient(serverId, config);
        results.success.push(result as never);
      } catch (error: any) {
        logger.error(`Failed to initialize client ${serverId}:`, error);
        results.errors.push({
          id: serverId,
          error: `Failed to initialize: ${error.message}`,
        } as never);
      }
    });

    // Wait for all clients to be processed
    await Promise.all(startPromises);

    // Return appropriate response
    if (results.errors.length === 0) {
      return res.status(201).json({
        message: 'All MCP clients started successfully',
        clients: results.success,
      });
    } else {
      return res.status(400).json({
        message: 'Some MCP clients failed to start',
        success: results.success,
        errors: results.errors,
      });
    }
  } catch (error: any) {
    logger.error('Error starting clients:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Restart a specific client
mcpRouter.post('/restart/:id', auth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const clientEntry = clients.get(id);

  if (!clientEntry) {
    return res.status(404).json({ error: 'Client not found' });
  }

  try {
    // Get the original configuration
    const config = clientEntry.config || {
      command: clientEntry.command,
      args: clientEntry.args,
      env: clientEntry.env,
    };

    // Close the existing client
    await clientEntry.client.close();
    clients.delete(id);

    // Start a new client with the same configuration
    const result = await startClient(id, config);

    return res.status(200).json({
      message: `Client ${id} restarted successfully`,
      client: result,
    });
  } catch (error: any) {
    logger.error(`Error restarting client ${id}:`, error);
    return res.status(500).json({
      error: 'Failed to restart client',
      details: error.message,
    });
  }
});

// Restart ALL connected MCP clients in place, each re-created from its
// stored original configuration. This is the server-side "hard refresh"
// signal: it tears down every connector (closing transports/subprocesses)
// and brings them back fresh, so stale tools are re-listed correctly.
//
// Unlike POST /start (which SKIPS clients whose config is unchanged),
// /restart-all forces a full reconnect regardless of config equality.
//
// Non-breaking: purely additive. Failures for individual clients are
// collected and reported; one client's failure does not abort the rest.
mcpRouter.post('/restart-all', auth, async (req: Request, res: Response) => {
  try {
    // Snapshot the IDs + configs first; the Map mutates as we restart.
    const snapshot = Array.from(clients.entries()).map(([id, entry]) => ({
      id,
      config: entry.config || {
        command: entry.command,
        args: entry.args,
        env: entry.env,
      },
    }));

    if (snapshot.length === 0) {
      return res.status(200).json({
        message: 'No MCP clients to restart',
        restarted: [],
        errors: [],
      });
    }

    const restarted: { id: string }[] = [];
    const errors: { id: string; error: string }[] = [];

    // Restart sequentially to avoid spawning/closing storms and to keep
    // the `clients` Map mutations predictable.
    for (const { id, config } of snapshot) {
      try {
        const existing = clients.get(id);
        if (existing) {
          await existing.client.close();
          clients.delete(id);
        }
        await startClient(id, config);
        restarted.push({ id });
      } catch (error: any) {
        logger.error(`Error restarting client ${id} during /restart-all:`, error);
        errors.push({ id, error: error.message });
        // Ensure no half-closed entry lingers in the Map.
        clients.delete(id);
      }
    }

    if (errors.length === 0) {
      return res.status(200).json({
        message: `All ${restarted.length} MCP client(s) restarted successfully`,
        restarted,
        errors,
      });
    }
    return res.status(207).json({
      message: `${restarted.length} restarted, ${errors.length} failed`,
      restarted,
      errors,
    });
  } catch (error: any) {
    logger.error('Error in /restart-all:', error);
    return res.status(500).json({
      error: 'Failed to restart all clients',
      details: error.message,
    });
  }
});

mcpRouter.get('/clients', auth, async (req: Request, res: Response) => {
  try {
    // Create an array of promises that will fetch tools for each client
    const clientDetailsPromises = Array.from(clients.values()).map(async (clientEntry) => {
      const { id, command, args, createdAt } = clientEntry;

      try {
        // Get tools for this client
        const result = await clientEntry.client.listTools();
        const tools = result.tools || [];

        // Extract just the tool names into an array
        const toolNames = tools.map((tool) => tool.name);

        return {
          id,
          command,
          args,
          createdAt,
          tools: toolNames,
        };
      } catch (error: any) {
        logger.error(`Error getting tools for client ${id}:`, error);
        return {
          id,
          command,
          args,
          createdAt,
          tools: [],
          toolError: error.message,
        };
      }
    });

    // Wait for all promises to resolve
    const clientsList = await Promise.all(clientDetailsPromises);

    res.status(200).json(clientsList);
  } catch (error: any) {
    logger.error('Error fetching clients list:', error);
    res.status(500).json({
      error: 'Failed to retrieve clients list',
      details: error.message,
    });
  }
});

mcpRouter.get('/clients/:id', auth, (req: Request, res: Response) => {
  const clientId = req.params.id;
  const clientEntry = clients.get(clientId);

  if (!clientEntry) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const { id, command, args, createdAt } = clientEntry;

  res.status(200).json({ id, command, args, createdAt });
});

// Get tools for a specific client
mcpRouter.get('/clients/:id/tools', auth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const clientEntry = clients.get(id);

  if (!clientEntry) {
    return res.status(404).json({ error: 'Client not found' });
  }

  try {
    const result = await clientEntry.client.listTools();
    res.status(200).json(result.tools);
  } catch (error: any) {
    logger.error(`Error getting tools for client ${id}:`, error);
    res.status(500).json({
      error: 'Failed to get tools',
      details: error.message,
    });
  }
});

// Call a tool for a specific client
mcpRouter.post('/clients/:id/call_tools', auth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, arguments: toolArgs } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Tool name is required' });
  }

  const clientEntry = clients.get(id);
  if (!clientEntry) {
    return res.status(404).json({ error: 'Client not found' });
  }

  try {
    const result = await clientEntry.client.callTool({
      name,
      arguments: toolArgs || {},
    });

    res.status(200).json(result);
  } catch (error: any) {
    logger.error(`Error calling tool for client ${id}:`, error);
    res.status(500).json({
      error: 'Failed to call tool',
      details: error.message,
    });
  }
});

// Clean up resources for a client
mcpRouter.delete('/clients/:id', auth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const clientEntry = clients.get(id);

  if (!clientEntry) {
    return res.status(404).json({ error: 'Client not found' });
  }

  try {
    // Close the client properly
    await clientEntry.client.close();
    clients.delete(id);

    res.status(200).json({ message: 'Client deleted successfully' });
  } catch (error: any) {
    logger.error(`Error deleting client ${id}:`, error);
    res.status(500).json({
      error: 'Failed to delete client',
      details: error.message,
    });
  }
});

export { mcpRouter };
