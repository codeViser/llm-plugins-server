import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import got from 'got';

import { createApiRequestBody } from '@/api-docs/openAPIRequestBuilders';
import { createApiResponse } from '@/api-docs/openAPIResponseBuilders';
import { ResponseStatus, ServiceResponse } from '@/common/models/serviceResponse';
import { handleServiceResponse, validateRequest } from '@/common/utils/httpHandlers';

import {
  GooglePlacesApiRequestBodySchema,
  GooglePlacesApiResponseSchema,
} from './googlePlacesModel';

export const googlePlacesRegistry = new OpenAPIRegistry();
googlePlacesRegistry.register('GooglePlacesApi', GooglePlacesApiResponseSchema);

googlePlacesRegistry.registerPath({
  method: 'post',
  path: '/google-places/query',
  tags: ['Google Places API'],
  summary: 'Proxies requests to the Google Places API using client-provided API key',
  request: {
    body: createApiRequestBody(GooglePlacesApiRequestBodySchema, 'application/json'),
  },
  responses: createApiResponse(GooglePlacesApiResponseSchema, 'Success'),
});

async function fetchFromGooglePlacesApi(params: z.infer<typeof GooglePlacesApiRequestBodySchema>) {
  let endpoint = '';
  const queryParams = new URLSearchParams({ key: params.apiKey });

  if (params.fields) {
    queryParams.append('fields', params.fields);
  }

  switch (params.searchType) {
    case 'textsearch':
      endpoint = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
      if (params.query) queryParams.append('query', params.query);
      else throw new Error("'query' is required for textsearch.");
      break;
    case 'nearbysearch':
      endpoint = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
      if (!params.location) {
        throw new Error("The 'location' parameter (latitude,longitude) is required for 'nearbysearch'.");
      }
      queryParams.append('location', params.location);
      queryParams.append('radius', (params.radius || 1500).toString());
      if (params.query) queryParams.append('keyword', params.query);
      break;
    case 'details':
      endpoint = 'https://maps.googleapis.com/maps/api/place/details/json';
      if (!params.placeId) {
        throw new Error("The 'placeId' parameter is required for 'details' searchType.");
      }
      queryParams.append('placeid', params.placeId);
      break;
    default:
      throw new Error(`Invalid searchType: ${params.searchType}.`);
  }

  const url = `${endpoint}?${queryParams.toString()}`;

  try {
    const response = await got(url).json();
    return response;
  } catch (error: any) {
    let errorMessage = `Google Places API error: ${error.message}`;
    if (error.response && error.response.body) {
      try {
        const errorBody = JSON.parse(error.response.body);
        errorMessage += ` - ${errorBody.error_message || JSON.stringify(errorBody)}`;
      } catch (e) {
        errorMessage += ` - ${error.response.body}`;
      }
    }
    throw new Error(errorMessage);
  }
}

export const googlePlacesRouter: Router = (() => {
  const router = express.Router();

  router.post(
    '/query',
    validateRequest(z.object({ body: GooglePlacesApiRequestBodySchema })),
    async (req: Request, res: Response) => {
      const requestBody = req.body as z.infer<typeof GooglePlacesApiRequestBodySchema>;
      const apiKeyToUse = requestBody.apiKey;

      if (!apiKeyToUse) {
        const errorServiceResponse = new ServiceResponse(
          ResponseStatus.Failed,
          'API Key for Google Places must be provided in the request body.',
          null,
          StatusCodes.BAD_REQUEST
        );
        return handleServiceResponse(errorServiceResponse, res);
      }

      try {
        const result = await fetchFromGooglePlacesApi(requestBody);
        const serviceResponse = new ServiceResponse(ResponseStatus.Success, 'Data fetched successfully', result, StatusCodes.OK);
        return handleServiceResponse(serviceResponse, res);
      } catch (error: any) {
        const errorMessage = error.message || 'An unknown error occurred while fetching from Google Places API.';
        const errorServiceResponse = new ServiceResponse(
          ResponseStatus.Failed,
          errorMessage,
          null,
          error.message.includes('parameter') || error.message.includes('Invalid searchType') || error.message.includes('API Key')
            ? StatusCodes.BAD_REQUEST
            : StatusCodes.INTERNAL_SERVER_ERROR
        );
        return handleServiceResponse(errorServiceResponse, res);
      }
    }
  );

  return router;
})(); 