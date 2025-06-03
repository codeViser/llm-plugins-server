import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { Router } from 'express';

import { createApiRequestBody } from '@/api-docs/openAPIRequestBuilders';
import { createApiResponse } from '@/api-docs/openAPIResponseBuilders';

import { handleTavilyMapProxy } from './tavilyMap.controller';
import { TavilyMapServerRequestBodySchema, TavilyMapServerResponseSchema } from './tavilyMapModel';

export const tavilyMapRegistry = new OpenAPIRegistry();

tavilyMapRegistry.registerPath({
  method: 'post',
  path: '/api/tavily/map', // This will be the mount path from the main router
  summary: 'Proxies requests to the Tavily Map API using a client-provided API key',
  tags: ['Tavily Map Proxy'],
  request: {
    body: createApiRequestBody(TavilyMapServerRequestBodySchema),
  },
  responses: createApiResponse(TavilyMapServerResponseSchema, 'Success'),
});

export const tavilyMapRouter: Router = (() => {
  const router = express.Router();
  // The actual endpoint will be POST / relative to where this router is mounted.
  // If mounted at '/api/tavily/map', this handles POST '/api/tavily/map'
  router.post('/', handleTavilyMapProxy);
  return router;
})();
