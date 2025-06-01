import express, { Router } from 'express';
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { createApiResponse } from '@/api-docs/openAPIResponseBuilders';
import { createApiRequestBody } from '@/api-docs/openAPIRequestBuilders';
import { handleTavilyCrawlProxy } from './tavilyCrawl.controller';
import { TavilyCrawlServerRequestBodySchema, TavilyCrawlServerResponseSchema } from './tavilyCrawlModel';

export const tavilyCrawlRegistry = new OpenAPIRegistry();

tavilyCrawlRegistry.registerPath({
  method: 'post',
  path: '/api/tavily/crawl', // Assuming this will be the mount path
  summary: 'Proxies requests to the Tavily Crawl API using client-provided API key (via Authorization header)',
  tags: ['Tavily Crawl Proxy'],
  request: createApiRequestBody(TavilyCrawlServerRequestBodySchema),
  responses: createApiResponse(TavilyCrawlServerResponseSchema, 'Success'),
});

export const tavilyCrawlRouter: Router = (() => {
  const router = express.Router();
  router.post('/', handleTavilyCrawlProxy);
  return router;
})(); 