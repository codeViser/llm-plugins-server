import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { Request, Response, Router } from 'express';
import got from 'got';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { createApiRequestBody } from '@/api-docs/openAPIRequestBuilders';
import { createApiResponse } from '@/api-docs/openAPIResponseBuilders';
import { ResponseStatus, ServiceResponse } from '@/common/models/serviceResponse';
import { handleServiceResponse, validateRequest } from '@/common/utils/httpHandlers';
import { logger } from '@/server';

import {
  AcademicPaperHarvesterRequestBody,
  AcademicPaperHarvesterRequestBodySchema,
  AcademicPaperHarvesterResponseSchema,
} from './academicPaperHarvesterModel';

const SEMANTIC_SCHOLAR_SEARCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/search';
const DEFAULT_FIELDS = [
  'paperId',
  'url',
  'title',
  'abstract',
  'year',
  'publicationDate',
  'authors.name',
  'venue',
  'publicationVenue',
  'externalIds',
  'isOpenAccess',
  'openAccessPdf',
  'citationCount',
].join(',');
const CACHE_TTL_MS = 2 * 60 * 1000;
const RETRY_BACKOFF_MS = 1000;
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRY_COUNT = 2;

type CachedSearchResult = {
  expiresAt: number;
  payload: z.infer<typeof AcademicPaperHarvesterResponseSchema>;
};

const semanticScholarCache = new Map<string, CachedSearchResult>();

class UpstreamRequestError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableResponse = (statusCode: number) => statusCode === StatusCodes.TOO_MANY_REQUESTS || statusCode >= 500;

const getFromCache = (cacheKey: string) => {
  const cachedResult = semanticScholarCache.get(cacheKey);
  if (!cachedResult) {
    return null;
  }
  if (cachedResult.expiresAt <= Date.now()) {
    semanticScholarCache.delete(cacheKey);
    return null;
  }
  return cachedResult.payload;
};

const saveToCache = (cacheKey: string, payload: z.infer<typeof AcademicPaperHarvesterResponseSchema>) => {
  semanticScholarCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
};

const getSemanticScholarData = async (requestBody: AcademicPaperHarvesterRequestBody) => {
  const resolvedApiKey = requestBody.apiKey?.trim() || undefined;
  const fields = requestBody.fields?.trim() || DEFAULT_FIELDS;
  const maxResults = requestBody.max_results ?? 5;
  const offset = requestBody.offset ?? 0;
  const upstreamTimeoutMs = requestBody.request_timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const upstreamRetryCount = requestBody.retry_count ?? DEFAULT_RETRY_COUNT;
  const cacheKey = JSON.stringify({
    query: requestBody.query,
    maxResults,
    offset,
    fields,
    hasApiKey: Boolean(resolvedApiKey),
  });

  const cachedResult = getFromCache(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (resolvedApiKey) {
    headers['x-api-key'] = resolvedApiKey;
  }

  let lastError: UpstreamRequestError | null = null;
  const totalAttempts = upstreamRetryCount + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const response = await got.get(SEMANTIC_SCHOLAR_SEARCH_URL, {
        searchParams: {
          query: requestBody.query,
          limit: maxResults.toString(),
          offset: offset.toString(),
          fields,
        },
        headers,
        timeout: { request: upstreamTimeoutMs },
        throwHttpErrors: false,
        responseType: 'text',
      });

      const statusCode = response.statusCode;
      const responseText = response.body ?? '';
      let responseBody: any = null;
      try {
        responseBody = responseText ? JSON.parse(responseText) : null;
      } catch {
        responseBody = null;
      }

      if (statusCode === StatusCodes.OK) {
        if (!responseBody || !Array.isArray(responseBody.data)) {
          if (/too many requests/i.test(responseText)) {
            lastError = new UpstreamRequestError('Semantic Scholar rate limit reached.', StatusCodes.TOO_MANY_REQUESTS);
            if (attempt < totalAttempts) {
              await sleep(RETRY_BACKOFF_MS * attempt);
              continue;
            }
            break;
          }
          throw new UpstreamRequestError(
            'Semantic Scholar returned an unexpected response format.',
            StatusCodes.BAD_GATEWAY
          );
        }

        const payload: z.infer<typeof AcademicPaperHarvesterResponseSchema> = {
          total: Number(responseBody.total ?? responseBody.data.length ?? 0),
          offset: Number(responseBody.offset ?? offset),
          next: responseBody.next == null ? null : Number(responseBody.next),
          data: responseBody.data,
          source: 'Semantic Scholar',
        };
        saveToCache(cacheKey, payload);
        return payload;
      }

      const messagePrefix =
        statusCode === StatusCodes.TOO_MANY_REQUESTS
          ? 'Semantic Scholar rate limit reached.'
          : `Semantic Scholar request failed with status ${statusCode}.`;
      const details = (responseBody?.error || responseBody?.message || responseText).slice(0, 280);
      lastError = new UpstreamRequestError(`${messagePrefix} ${details}`, statusCode);

      if (isRetryableResponse(statusCode) && attempt < totalAttempts) {
        await sleep(RETRY_BACKOFF_MS * attempt);
        continue;
      }
      break;
    } catch (error: unknown) {
      const message = (error as Error).message || 'Network failure while contacting Semantic Scholar.';
      lastError = new UpstreamRequestError(message, StatusCodes.BAD_GATEWAY);
      if (attempt < totalAttempts) {
        await sleep(RETRY_BACKOFF_MS * attempt);
        continue;
      }
      break;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new UpstreamRequestError('Semantic Scholar request failed for an unknown reason.');
};

export const academicPaperHarvesterRegistry = new OpenAPIRegistry();
academicPaperHarvesterRegistry.register('AcademicPaperHarvesterResponse', AcademicPaperHarvesterResponseSchema);

academicPaperHarvesterRegistry.registerPath({
  method: 'post',
  path: '/academic-paper-harvester/search',
  tags: ['Academic Paper Harvester'],
  summary: 'Searches Semantic Scholar server-side to avoid browser CORS issues',
  request: {
    body: createApiRequestBody(AcademicPaperHarvesterRequestBodySchema, 'application/json'),
  },
  responses: createApiResponse(AcademicPaperHarvesterResponseSchema, 'Success'),
});

export const academicPaperHarvesterRouter: Router = (() => {
  const router = express.Router();

  // Lightweight connectivity probe — lets the plugin verify the server is reachable and
  // CORS headers are present before attempting a full search.
  router.get('/ping', (_req: Request, res: Response) => {
    res.status(StatusCodes.OK).json({ ok: true, service: 'academic-paper-harvester' });
  });

  router.post(
    '/search',
    validateRequest(z.object({ body: AcademicPaperHarvesterRequestBodySchema })),
    async (req: Request, res: Response) => {
      try {
        const requestBody = req.body as AcademicPaperHarvesterRequestBody;
        const result = await getSemanticScholarData(requestBody);
        const serviceResponse = new ServiceResponse(
          ResponseStatus.Success,
          'Papers retrieved successfully',
          result,
          StatusCodes.OK
        );
        return handleServiceResponse(serviceResponse, res);
      } catch (error: unknown) {
        const typedError = error as UpstreamRequestError;
        logger.error(
          { message: typedError.message, statusCode: typedError.statusCode },
          'Academic paper harvester proxy request failed'
        );

        const statusCode =
          typedError.statusCode === StatusCodes.TOO_MANY_REQUESTS
            ? StatusCodes.TOO_MANY_REQUESTS
            : typedError.statusCode && typedError.statusCode >= 400 && typedError.statusCode < 500
              ? StatusCodes.BAD_GATEWAY
              : StatusCodes.BAD_GATEWAY;

        const message =
          typedError.statusCode === StatusCodes.TOO_MANY_REQUESTS
            ? `${typedError.message} Configure a Semantic Scholar API key in plugin settings to improve limits.`
            : typedError.message || 'Failed to retrieve papers from Semantic Scholar.';

        const serviceResponse = new ServiceResponse(ResponseStatus.Failed, message, null, statusCode);
        return handleServiceResponse(serviceResponse, res);
      }
    }
  );

  return router;
})();
