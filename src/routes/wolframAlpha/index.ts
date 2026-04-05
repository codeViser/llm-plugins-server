import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { Router } from 'express';

import { createApiRequestBody } from '@/api-docs/openAPIRequestBuilders';
import { createApiResponse } from '@/api-docs/openAPIResponseBuilders';

import { handleWolframAlphaQuery } from './wolframAlpha.controller';
import { WolframAlphaRequestBodySchema, WolframAlphaResponseSchema } from './wolframAlphaModel';

export const wolframAlphaRegistry = new OpenAPIRegistry();

wolframAlphaRegistry.registerPath({
  method: 'post',
  path: '/wolfram-alpha',
  summary: 'Proxy Wolfram Alpha LLM API queries through server to avoid CORS',
  tags: ['Wolfram Alpha'],
  request: {
    body: createApiRequestBody(WolframAlphaRequestBodySchema),
  },
  responses: createApiResponse(WolframAlphaResponseSchema, 'Success'),
});

export const wolframAlphaRouter: Router = (() => {
  const router = express.Router();
  router.post('/', handleWolframAlphaQuery);
  return router;
})();
