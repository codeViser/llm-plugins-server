import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { createApiRequestBody } from '@/api-docs/openAPIRequestBuilders';
import { createApiResponse } from '@/api-docs/openAPIResponseBuilders';
import { ResponseStatus, ServiceResponse } from '@/common/models/serviceResponse';
import { handleServiceResponse, validateRequest } from '@/common/utils/httpHandlers';

import { GooglePlacesApiRequestBodySchema, GooglePlacesApiResponseSchema } from './googlePlacesModel';
import { fetchFromGooglePlacesApi } from './googlePlaces.service';

export const googlePlacesRegistry = new OpenAPIRegistry();
googlePlacesRegistry.register('GooglePlacesApi', GooglePlacesApiResponseSchema);

googlePlacesRegistry.registerPath({
  method: 'post',
  path: '/google-places/query',
  tags: ['Google Places API'],
  summary:
    'Proxies requests to Google Places API (New) using a client-provided API key; legacy-shaped JSON for TypingMind plugins',
  request: {
    body: createApiRequestBody(GooglePlacesApiRequestBodySchema, 'application/json'),
  },
  responses: createApiResponse(GooglePlacesApiResponseSchema, 'Success'),
});

export const googlePlacesRouter: Router = (() => {
  const router = express.Router();

  router.post(
    '/query',
    validateRequest(z.object({ body: GooglePlacesApiRequestBodySchema })),
    async (req: Request, res: Response) => {
      try {
        const requestBody = req.body as z.infer<typeof GooglePlacesApiRequestBodySchema>;
        const result = await fetchFromGooglePlacesApi(requestBody);

        if (result.status && result.status !== 'OK') {
          const errorServiceResponse = new ServiceResponse(
            ResponseStatus.Failed,
            result.error_message || `Google Places status: ${result.status}`,
            result,
            StatusCodes.BAD_REQUEST
          );
          handleServiceResponse(errorServiceResponse, res);
          return;
        }

        const serviceResponse = new ServiceResponse(
          ResponseStatus.Success,
          'Data fetched successfully',
          result,
          StatusCodes.OK
        );
        handleServiceResponse(serviceResponse, res);
      } catch (error: unknown) {
        const err = error as Error & { legacy?: Record<string, unknown> };
        const errorMessage = err.message || 'An unknown error occurred while fetching from Google Places API.';
        const legacyBody = err.legacy ?? null;
        const errorServiceResponse = new ServiceResponse(
          ResponseStatus.Failed,
          errorMessage,
          legacyBody,
          errorMessage.includes('parameter') ||
          errorMessage.includes('Invalid searchType') ||
          errorMessage.includes('API Key')
            ? StatusCodes.BAD_REQUEST
            : StatusCodes.INTERNAL_SERVER_ERROR
        );
        handleServiceResponse(errorServiceResponse, res);
      }
    }
  );

  return router;
})();
