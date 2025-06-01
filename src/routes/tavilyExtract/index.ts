import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { Router } from 'express';

import { createApiRequestBody } from '@/api-docs/openAPIRequestBuilders';
import { createApiResponse } from '@/api-docs/openAPIResponseBuilders';

import { handleAdvancedExtract } from './tavilyExtract.controller';
import { TavilyExtractServerRequestBodySchema, TavilyExtractServerResponseSchema } from './tavilyExtractModel';

export const tavilyExtractRegistry = new OpenAPIRegistry();

tavilyExtractRegistry.registerPath({
  method: 'post',
  path: '/api/tavily/extract',
  summary: 'Handles advanced Tavily content extraction via server',
  tags: ['Tavily Extract'],
  request: {
    body: createApiRequestBody(TavilyExtractServerRequestBodySchema),
  },
  responses: createApiResponse(TavilyExtractServerResponseSchema, 'Success'),
  // You might want to add other responses, e.g., for 400, 401, 500 errors
  // For example:
  // ...createApiResponse(z.object({ error: z.string() }), 'Bad Request', StatusCodes.BAD_REQUEST),
});

export const tavilyExtractRouter: Router = (() => {
  const router = express.Router();
  router.post('/', handleAdvancedExtract);
  return router;
})();
