import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { Router } from 'express';

import { createApiRequestBody } from '@/api-docs/openAPIRequestBuilders';
import { createApiResponse } from '@/api-docs/openAPIResponseBuilders';

import { handlePerplexitySearchProxy } from './perplexitySearch.controller';
import { PerplexitySearchServerRequestBodySchema, PerplexitySearchServerResponseSchema } from './perplexitySearchModel';

export const perplexitySearchRegistry = new OpenAPIRegistry();

perplexitySearchRegistry.registerPath({
  method: 'post',
  path: '/api/perplexity/search',
  summary: 'Proxies requests to the Perplexity Sonar API using client-provided API key',
  tags: ['Perplexity Search Proxy'],
  request: createApiRequestBody(PerplexitySearchServerRequestBodySchema),
  responses: createApiResponse(PerplexitySearchServerResponseSchema, 'Success'),
});

export const perplexitySearchRouter: Router = (() => {
  const router = express.Router();
  router.post('/', handlePerplexitySearchProxy);
  return router;
})();
