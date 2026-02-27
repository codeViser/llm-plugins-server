import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';

import { createApiResponse } from '@/api-docs/openAPIResponseBuilders';
import { ResponseStatus, ServiceResponse } from '@/common/models/serviceResponse';
import { handleServiceResponse } from '@/common/utils/httpHandlers';
import { logger } from '@/server';

import {
  PaperDiscoveryResponseSchema,
  PaperDiscoveryResult,
  PaperDiscoverySearchQuery,
  PaperDiscoverySearchQuerySchema,
} from './paperDiscoveryModel';

const SEMANTIC_SCHOLAR_SEARCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/search';
const OPENALEX_WORKS_URL = 'https://api.openalex.org/works';

class PaperDiscoveryError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

const semanticScholarFields = [
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const dedupePapers = (papers: PaperDiscoveryResult[]) => {
  const unique = new Map<string, PaperDiscoveryResult>();
  for (const paper of papers) {
    const key = (paper.doi || paper.arxivId || paper.title).trim().toLowerCase();
    if (!key) {
      continue;
    }
    if (!unique.has(key)) {
      unique.set(key, paper);
    }
  }
  return [...unique.values()];
};

const extractAbstractFromOpenAlexInvertedIndex = (invertedIndex: Record<string, number[]> | null | undefined) => {
  if (!invertedIndex || typeof invertedIndex !== 'object') {
    return null;
  }
  const indexedWords: Array<{ word: string; index: number }> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const position of positions) {
      indexedWords.push({ word, index: position });
    }
  }
  indexedWords.sort((a, b) => a.index - b.index);
  return indexedWords.map((item) => item.word).join(' ');
};

const fetchOpenAlex = async (params: PaperDiscoverySearchQuery): Promise<PaperDiscoveryResult[]> => {
  const url = new URL(OPENALEX_WORKS_URL);
  url.searchParams.set('search', params.query);
  url.searchParams.set('per-page', String(params.max_results));
  url.searchParams.set('sort', 'relevance_score:desc');
  url.searchParams.set(
    'select',
    [
      'id',
      'doi',
      'title',
      'publication_year',
      'authorships',
      'open_access',
      'cited_by_count',
      'primary_location',
      'best_oa_location',
      'biblio',
      'abstract_inverted_index',
    ].join(',')
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.request_timeout_ms);
  try {
    const response = await fetch(url.toString(), { method: 'GET', signal: controller.signal });
    if (!response.ok) {
      const text = await response.text();
      throw new PaperDiscoveryError(`OpenAlex request failed with HTTP ${response.status}: ${text.slice(0, 220)}`, response.status);
    }
    const payload = (await response.json()) as any;
    const results = Array.isArray(payload?.results) ? payload.results : [];
    return results.map((item: any) => ({
      source: 'OpenAlex',
      title: item?.title || 'N/A',
      authors: Array.isArray(item?.authorships)
        ? item.authorships.map((a: any) => a?.author?.display_name).filter(Boolean)
        : [],
      year: Number.isFinite(item?.publication_year) ? item.publication_year : null,
      abstract: extractAbstractFromOpenAlexInvertedIndex(item?.abstract_inverted_index),
      paperUrl: item?.primary_location?.landing_page_url || item?.id || item?.doi || null,
      pdfUrl: item?.best_oa_location?.pdf_url || item?.open_access?.oa_url || null,
      doi: typeof item?.doi === 'string' ? item.doi.replace('https://doi.org/', '') : null,
      arxivId: typeof item?.biblio?.volume === 'string' && item?.id?.includes('arxiv') ? item.biblio.volume : null,
      citationCount: Number.isFinite(item?.cited_by_count) ? item.cited_by_count : null,
      venue: item?.primary_location?.source?.display_name || null,
    }));
  } finally {
    clearTimeout(timeout);
  }
};

const fetchSemanticScholar = async (params: PaperDiscoverySearchQuery): Promise<PaperDiscoveryResult[]> => {
  const url = new URL(SEMANTIC_SCHOLAR_SEARCH_URL);
  url.searchParams.set('query', params.query);
  url.searchParams.set('limit', String(params.max_results));
  url.searchParams.set('offset', '0');
  url.searchParams.set('fields', semanticScholarFields);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (params.semantic_api_key) {
    headers['x-api-key'] = params.semantic_api_key;
  }

  let lastError: PaperDiscoveryError | null = null;
  const maxAttempts = params.semantic_api_key ? 2 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.request_timeout_ms);
    try {
      const response = await fetch(url.toString(), { method: 'GET', headers, signal: controller.signal });
      const text = await response.text();
      let payload: any = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const errMsg = payload?.error || payload?.message || text || 'Unknown Semantic Scholar failure';
        lastError = new PaperDiscoveryError(
          `Semantic Scholar request failed with HTTP ${response.status}: ${String(errMsg).slice(0, 220)}`,
          response.status
        );
        if (response.status === StatusCodes.TOO_MANY_REQUESTS && attempt < maxAttempts) {
          await sleep(700 * attempt);
          continue;
        }
        break;
      }

      if (!payload || !Array.isArray(payload.data)) {
        throw new PaperDiscoveryError('Semantic Scholar returned an unexpected response format.', StatusCodes.BAD_GATEWAY);
      }

      return payload.data.map((paper: any) => ({
        source: 'Semantic Scholar',
        title: paper?.title || 'N/A',
        authors: Array.isArray(paper?.authors) ? paper.authors.map((a: any) => a?.name).filter(Boolean) : [],
        year: Number.isFinite(paper?.year) ? paper.year : null,
        abstract: paper?.abstract || null,
        paperUrl: paper?.url || null,
        pdfUrl: paper?.isOpenAccess && paper?.openAccessPdf?.url ? paper.openAccessPdf.url : null,
        doi: paper?.externalIds?.DOI || null,
        arxivId: paper?.externalIds?.ArXiv || null,
        citationCount: Number.isFinite(paper?.citationCount) ? paper.citationCount : null,
        venue: paper?.venue || paper?.publicationVenue?.name || null,
      }));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new PaperDiscoveryError('Semantic Scholar request failed for unknown reason.');
};

const runSearch = async (params: PaperDiscoverySearchQuery) => {
  if (params.source_strategy === 'semantic_only') {
    const semanticResults = await fetchSemanticScholar(params);
    return semanticResults.slice(0, params.max_results);
  }

  const openAlexResults = await fetchOpenAlex(params);
  if (params.source_strategy === 'openalex_only') {
    return openAlexResults.slice(0, params.max_results);
  }

  if (openAlexResults.length >= params.max_results) {
    return openAlexResults.slice(0, params.max_results);
  }

  // For cross-discipline reliability, OpenAlex is primary. We add Semantic Scholar as optional enrichment.
  try {
    const semanticResults = await fetchSemanticScholar({
      ...params,
      max_results: Math.max(1, params.max_results - openAlexResults.length),
    });
    return dedupePapers([...openAlexResults, ...semanticResults]).slice(0, params.max_results);
  } catch (error) {
    logger.warn({ error: (error as Error).message }, 'Semantic Scholar enrichment failed; returning OpenAlex-only results');
    return openAlexResults.slice(0, params.max_results);
  }
};

export const paperDiscoveryRegistry = new OpenAPIRegistry();
paperDiscoveryRegistry.register('PaperDiscoveryResponse', PaperDiscoveryResponseSchema);
paperDiscoveryRegistry.registerPath({
  method: 'get',
  path: '/paper-discovery/search',
  tags: ['Paper Discovery'],
  summary: 'Searches scholarly papers across disciplines (OpenAlex + optional Semantic Scholar)',
  request: {
    query: PaperDiscoverySearchQuerySchema,
  },
  responses: createApiResponse(PaperDiscoveryResponseSchema, 'Success'),
});

export const paperDiscoveryRouter: Router = (() => {
  const router = express.Router();

  router.get('/ping', (_req: Request, res: Response) => {
    res.status(StatusCodes.OK).json({ ok: true, service: 'paper-discovery' });
  });

  router.get('/search', async (req: Request, res: Response) => {
    const parsed = PaperDiscoverySearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const serviceResponse = new ServiceResponse(
        ResponseStatus.Failed,
        'Invalid query parameters',
        { errors: parsed.error.errors },
        StatusCodes.BAD_REQUEST
      );
      handleServiceResponse(serviceResponse, res);
      return;
    }

    const params = parsed.data;
    try {
      const papers = await runSearch(params);
      const serviceResponse = new ServiceResponse(
        ResponseStatus.Success,
        'Papers retrieved successfully',
        {
          query: params.query,
          strategy: params.source_strategy,
          totalReturned: papers.length,
          papers,
        },
        StatusCodes.OK
      );
      handleServiceResponse(serviceResponse, res);
    } catch (error: unknown) {
      const typedError = error as PaperDiscoveryError;
      logger.error({ message: typedError.message, statusCode: typedError.statusCode }, 'Paper discovery request failed');
      const serviceResponse = new ServiceResponse(
        ResponseStatus.Failed,
        typedError.message || 'Failed to retrieve papers.',
        null,
        typedError.statusCode || StatusCodes.BAD_GATEWAY
      );
      handleServiceResponse(serviceResponse, res);
    }
  });

  return router;
})();
